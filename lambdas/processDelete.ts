import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, DeleteCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event: any) => {
  console.log("Event ", event);
  for (const record of event.Records) {     //https://docs.aws.amazon.com/lambda/latest/dg/with-sns-example.html
    console.log("Record ", record)
    const snsMessage = JSON.parse(record.Sns.Message);

    if (snsMessage.Records) {
      console.log("message body ", JSON.stringify(snsMessage));

      for (const messageRecord of snsMessage.Records) {                                 
          
          const s3e = messageRecord.s3;                                           

          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));
          console.log('srcKey ', JSON.stringify(srcKey))

          console.log("deleting from dynamoDB")


          const dbParams = {
            TableName: "Images", // reference image table from eda-stack-app
            Key: {  // had item instead of key
              "FileName": srcKey
            }
          }

          const delCommand = new DeleteCommand(dbParams); // got an error that key was missing ^ added to dbparams above

          try {
            await ddbDocClient.send(delCommand);
            console.log(`Item with key ${srcKey} deleted successfully.`);
          } catch (err) {
            console.error(`Error deleting item with key ${srcKey}:`, err);
          }
      }
    }
  }
}

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}