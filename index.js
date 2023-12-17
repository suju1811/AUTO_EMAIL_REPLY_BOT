import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { authenticate } from "@google-cloud/local-auth";
import {google} from "googleapis";

const app = express();

//scopes wa wanna access from google api
const Scopes = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://mail.google.com/"
];
const repliedUsers = new Set();//list to replied users

app.get("/",async(req,res)=>{
 
  //step1: login with gmail account and authenticate
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, "credentials.json"),
    scopes: Scopes,
  });

  //function is use to fetch all emails 
  async function getMessages(auth) {
    const gmail = google.gmail({version:"v1",auth});
    const response = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: "is:unread",
    });
    
    return response.data.messages || [];
  }
   
//function creates label if not created else return the id of label
async function createLabelIfNeeded(labelName) {
    const gmail = google.gmail({ version: "v1", auth});
    //Check if the label already exists.
    const res = await gmail.users.labels.list({ userId: "me" });
    const labels = res.data.labels;
  
    const existingLabel = labels.find((label) => label.name === labelName);
    if (existingLabel) {
      return existingLabel.id;
    }
  
    //Create the label if it doesn't exist.
    const newLabel = await gmail.users.labels.create({
      userId: "me",
      requestBody: {
        name: labelName,
        labelListVisibility: "labelShow",
        messageListVisibility: "show",
      },
    });
  
    return newLabel.data.id;
  }

  function messageBody(to, subject, message) {
    var str = ["Content-Type: text/plain; charset=\"UTF-8\"\n",
        "MIME-Version: 1.0\n",
        "Content-Transfer-Encoding: 7bit\n",
        "to: ", to, "\n",
        "subject: Re:", subject, "\n\n",
        message
    ].join('');

    var encodedMail = Buffer.from(str).toString("base64");
    return encodedMail;
   }

   async function main(){
      try{
      const gmail = google.gmail({version:"v1",auth});
      //step2: Fetch all emails and check are they replied yet
      const messages = await getMessages(auth);
      if (messages && messages.length > 0) {
        for (const message of messages) {
            //get email
            const email = await gmail.users.messages.get({
                userId: "me",
                id: message.id,
            });
            const from = email.data.payload.headers.find((header) => header.name === "From"
            ).value;
            const to = email.data.payload.headers.find((header) => header.name === "To").value;
            const sub = email.data.payload.headers.find((header) => header.name === "Subject").value;
            const msg = "Thank you for your email. I'm currently on vacation and will get back to you ASAP!!";
            //Check if email has already been replied
            if (repliedUsers.has(from)) {
              console.log("Already replied to : ", from);
              continue;
            }

            //isolated the email into threads and check if it have any previous replies
            const thread = await gmail.users.threads.get({
               userId: "me",
               id: message.threadId,
            });
            const replies = thread.data.messages.slice(1);
            //send replies to Emails that have no prior replies
            if (replies.length === 0) {
                //Create Message Reply.
                const replyMessage = {
                    userId: "me",
                    resource: { raw: messageBody(from,sub,msg)}
                };
                //send message
                await gmail.users.messages.send(replyMessage);
                //step3: tag email with a label in the Gmail
                const labelName = "AutoVacationReply";
                await gmail.users.messages.modify({
                    userId: "me",
                    id: message.id,
                    requestBody: {
                      addLabelIds: [await createLabelIfNeeded(labelName)],
                      removeLabelIds: ["INBOX"],
                    },
                });
                
                repliedUsers.add(from);
            };
        }
      }
      }catch(error){
        console.error(error);
      }
    }
  //step4: do step 1,2,3 in Repeat in Random intervals between (45--120) sec
  function getRandomInterval(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
  }
  setInterval(main, getRandomInterval(45, 120) * 1000);
  res.json({ "this is Auth": auth });
});

const PORT = process.env.PORT||5000;
app.listen(PORT,()=>{
    console.log(`Server is running on ${PORT}...`);
})