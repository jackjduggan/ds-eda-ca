import { SNSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const ddbDocClient = createDDbDocClient();

export const handler: SNSHandler = async (event) => {
  console.log("Event ", event);

  for (const record of event.Records) {

    console.log("Record ", record);
    const parsedRecordMessage = JSON.parse(record.Sns.Message);
    const snsMessage = parsedRecordMessage;

    if (snsMessage) {
        const srcKey = snsMessage.name; // image name is object key
        const description = snsMessage.description; // description to add

        const updateParams = {
        TableName: process.env.TABLE_NAME,
        Key: { FileName: srcKey },
        UpdateExpression: "set Description = :d",
        ExpressionAttributeValues: {
            ":d": description
        }
        };

        try {
        await ddbDocClient.send(new UpdateCommand(updateParams));
        console.log(`Item with key ${srcKey} updated successfully.`);
        } catch (err) {
        console.error(`Error updating item with key ${srcKey}:`, err);
        }
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