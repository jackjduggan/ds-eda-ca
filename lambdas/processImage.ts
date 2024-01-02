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
import { DynamoDBClient } from "@aws-sdk/client-dynamodb"; //new import
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

// Initialize dynamodb
const ddbDocClient = createDDbDocClient();
// Initiialize s3
const s3Client = new S3Client();

export const handler: SQSHandler = async (event) => {
  console.log("Event ", event);

  for (const record of event.Records) {

    const recordBody = JSON.parse(record.body);
    console.log('Record Body ',JSON.stringify(recordBody))

    const recordMessage = JSON.parse(recordBody.Message);
    console.log('SNS Message: ', recordMessage)

    if (recordMessage.Records) {
      for (const s3Record of recordMessage.Records) {

          const s3e = s3Record.s3;
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
          console.log('imageType is ', imageType)
          if (imageType != "jpeg" && imageType != "png") {
            console.log(`Unsupported image type: ${imageType}`);
            throw new Error("Unsupported image type: ${imageType}. ");
          }

          console.log("successful - adding into table")

          const dbParams = {
            TableName: "Images", // reference image table from eda-stack-app
            Item: { 
              "FileName": srcKey
            }
          }
            
          const putCommand = new PutCommand(dbParams);

          // write to table
          await ddbDocClient.send(putCommand);
        }
      } else {
        console.log('error: no records')
      }
    }
};

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