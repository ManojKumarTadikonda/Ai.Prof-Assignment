import 'dotenv/config';
import {assessHolistic} from './services/ai.js';

const protocol='Post-discharge follow-up protocol. Treat incomplete or conflicting information as uncertain and require human review. Worsening pain, fever, difficulty breathing, severe bleeding, or fainting require escalation.';
const answers=[
  {question:'How are you feeling since discharge?',answer:'I feel okay and my symptoms are improving.'},
  {question:'Are you experiencing any pain, and is it improving or worsening?',answer:'Mild pain, but it is getting better.'},
  {question:'Do you have a fever or chills?',answer:'No fever or chills.'},
  {question:'Do you have any new or worsening symptoms?',answer:'No.'},
  {question:'Do you have any other concerns you want the care team to know about?',answer:'No other concerns.'}
];

if(!process.env.GEMINI_API_KEY){console.error('GEMINI_API_KEY is missing');process.exit(1);}
console.log(`Testing Gemini model: ${process.env.GEMINI_MODEL||'gemini-2.5-flash'}`);
const result=await assessHolistic({answers,protocolText:protocol});
console.log(JSON.stringify(result,null,2));
console.log('\nGemini test completed. This test does not write to MongoDB or send an email.');
