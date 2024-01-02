import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb"
import { Construct } from "constructs";

export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

    // New image table, using file name as primary key.
    const imageTable = new dynamodb.Table(this, "ImageTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // added billing mode as that's what I had in CA1
      partitionKey: { name: "FileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
    });
    
    // Integration infrastructure

    // intermediate queue no longer needed.
    // const mailerQ = new sqs.Queue(this, "mailer-queue", {
    //   receiveMessageWaitTime: cdk.Duration.seconds(10),
    // });

    //create new DLQ - untested
    const deadLetterQ = new sqs.Queue(this, "deadLetter-queue", { 
      //receiveMessageWaitTime: cdk.Duration.seconds(10),
      retentionPeriod: cdk.Duration.minutes(30),
      //queueName: "deadLetterQueue"
    });
 

    const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
      receiveMessageWaitTime: cdk.Duration.seconds(10),
      deadLetterQueue: {
        queue: deadLetterQ,
        maxReceiveCount: 3 // not sure if this value actually matters.
      },
      //retentionPeriod: cdk.Duration.seconds(60) // must be 60 seconds or more.
    });


    // Topics

    const newImageTopic = new sns.Topic(this, "NewImageTopic", {
      displayName: "New Image topic",
    });

    // second topic added for phase 2 - handles object deletion and description
    const delOrDescTopic = new sns.Topic(this, "DelOrDescTopic", {
      displayName: "Image deletion or decription topic",
    });

    // Lambda functions

    const processImageFn = new lambdanode.NodejsFunction(
      this,
      "ProcessImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processImage.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        deadLetterQueue: deadLetterQ,
        environment: {
          TABLE_NAME: imageTable.tableName,
          //TABLE_NAME: "Images",
          REGION: 'eu-west-1',
        },
      }
    );

    const mailerFn = new lambdanode.NodejsFunction(this, "mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024,
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/mailer.ts`,
    });

    const rejectionMailerFn = new lambdanode.NodejsFunction(this, "rejection-mailer-function", {
      runtime: lambda.Runtime.NODEJS_16_X,
      memorySize: 1024, // increase memory just in case - same as mailerFn
      timeout: cdk.Duration.seconds(3),
      entry: `${__dirname}/../lambdas/rejectionMailer.ts`,
    });

    const deleteImageFn = new lambdanode.NodejsFunction(this, "DeleteImageFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/processDelete.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageTable.tableName,
          //TABLE_NAME: "Images",
          REGION: 'eu-west-1',
        },
      }
    );

    const updateTableFn = new lambdanode.NodejsFunction(this, "UpdateTableFn",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        entry: `${__dirname}/../lambdas/updateTable.ts`,
        timeout: cdk.Duration.seconds(15),
        memorySize: 128,
        environment: {
          TABLE_NAME: imageTable.tableName,
          //TABLE_NAME: "Images",
          REGION: 'eu-west-1',
        },
      }
    );

    // Event triggers

    imagesBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SnsDestination(newImageTopic)
    );


    imagesBucket.addEventNotification( // delete from image event
      s3.EventType.OBJECT_REMOVED,
      new s3n.SnsDestination(delOrDescTopic) // i was calling the deleteImage lambda here for some reason... realised and fixed.
    );

    const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });

    // intermediate event source no longer needed
    // const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
    //   batchSize: 5,
    //   maxBatchingWindow: cdk.Duration.seconds(10),
    // });

    const rejectionMailerEventSource = new events.SqsEventSource(deadLetterQ, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    });


    newImageTopic.addSubscription(
      new subs.SqsSubscription(imageProcessQueue, 
      ),
    );

    // intermediate queue is no longer a subscriber to topic
    // newImageTopic.addSubscription(
    //   new subs.SqsSubscription(mailerQ)
    //   );
    // instead, the lambda needs to be directly subscribed to the SNS topic
    // that can be done with the subs.LambdaSubscription(lambda_fn)
    const lambdaSubMailer = new subs.LambdaSubscription(mailerFn)
    newImageTopic.addSubscription(lambdaSubMailer);

    // classmate provided helpful youtube video to help figuring this out.
    // ref: https://www.youtube.com/watch?v=36iMOJQUAuE&start=217
    const lambdaSubDelete = new subs.LambdaSubscription(deleteImageFn, {
      filterPolicyWithMessageBody: {
        Records: sns.FilterOrPolicy.policy({ // ref: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_sns.FilterOrPolicy.html
          eventName: sns.FilterOrPolicy.filter(sns.SubscriptionFilter.stringFilter({
            matchPrefixes: ['ObjectRemoved'] // ref: https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-event-types-and-destinations.html
          }))
        })
      }
    }); // subscribe process delete to new topic

    const lambdaSubUpdate = new subs.LambdaSubscription(updateTableFn, {
      filterPolicy: {
        comment_type: sns.SubscriptionFilter.stringFilter({
          // specifying a message attribute which will be used in the publish command
          // ref: https://docs.aws.amazon.com/cli/latest/reference/sns/publish.html
          allowlist: ["update"], 
        }),
      }
    });

    delOrDescTopic.addSubscription(lambdaSubDelete); 
    delOrDescTopic.addSubscription(lambdaSubUpdate); // subscribe update table to new topic

    processImageFn.addEventSource(newImageEventSource);

    //mailerFn.addEventSource(newImageMailEventSource);

    rejectionMailerFn.addEventSource(rejectionMailerEventSource);

    // Permissions

    imagesBucket.grantRead(processImageFn);
    imageTable.grantReadWriteData(processImageFn);
    imageTable.grantReadWriteData(deleteImageFn); // give delete function write perms
    imageTable.grantReadWriteData(updateTableFn);

    // Policy roles

    mailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    rejectionMailerFn.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "ses:SendEmail",
          "ses:SendRawEmail",
          "ses:SendTemplatedEmail",
        ],
        resources: ["*"],
      })
    );

    // Output
    
    new cdk.CfnOutput(this, "bucketName", {
      value: imagesBucket.bucketName,
    });

    // output the SNS topic ARN so I don't have to go into AWS and get it myself every time.
    new cdk.CfnOutput(this, 'TopicArn', {
      value: delOrDescTopic.topicArn,
      description: 'ARN of the SNS Topic',
    });


  }
}
