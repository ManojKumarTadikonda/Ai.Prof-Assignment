import 'dotenv/config';
import {sendOutreachEmail} from './services/email.js';

const to=process.env.TEST_EMAIL_TO;
if(!to){console.error('Set TEST_EMAIL_TO in backend/.env before running this test.');process.exit(1);}
const link=process.env.APP_URL||'http://localhost:5173';
console.log(`Sending test email to ${to} using link base ${link}`);
const result=await sendOutreachEmail({to,patientName:'Demo Patient',link:`${link}/patient/followup/TEST-TOKEN`,hospitalName:'CareFlow AI Demo Hospital'});
console.log('Email test result:',result);
