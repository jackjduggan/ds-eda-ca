/* eslint-disable import/extensions, import/no-absolute-path */
import { SQSHandler } from "aws-lambda";
// import { sharp } from "/opt/nodejs/sharp-utils";
import {
  GetObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  S3Client,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb"; //new import
import { error } from "console";

const s3 = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("Event ", event);

  // Initialize dynamodb
  const ddbClient = new DynamoDBClient({ region: "eu-west-1" });

  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    console.log('Raw SNS message ',JSON.stringify(recordBody))
    if (recordBody.Records) {
      for (const messageRecord of recordBody.Records) {
        const s3e = messageRecord.s3;
        const srcBucket = s3e.bucket.name;

        // Object key may have spaces or unicode non-ASCII characters.
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

        // Infer the image type from the file suffix.
        const typeMatch = srcKey.match(/\.([^.]*)$/);
        if (!typeMatch) {
          console.log("Could not determine the image type.");
          throw new Error("Could not determine the image type. ");
        }

        // check that the image type is either jpeg or png
        const imageType = typeMatch[1].toLowerCase();
        if (imageType === "jpeg" || imageType === "png") {
          // process image upload 

          const dbParams = {
            TableName: "ImageTable",
            Item: { fileName: { S: srcKey } }
          };

          try {
            // write to table
            await ddbClient.send(new PutItemCommand(dbParams));
            console.log(`Successfully wrote ${srcKey} to DynamoDB table.`); // must use backticks for template
          } catch (dbError) {
            console.error("Error writing to DynamoDB", dbError);
            // error handling...
          }
        } else {
          console.log(`Unsupported image type: ${imageType}`);
          // send message to dlq?
        }
      }
    }
  }
};