import fs from 'node:fs';
import {GoogleGenAI,createUserContent,createPartFromUri} from '@google/genai';
import {env} from '../config/env.js';
const ai=env.geminiKey?new GoogleGenAI({apiKey:env.geminiKey}):null;
const schema={type:'object',properties:{detected_language:{type:'string'},transcript:{type:'string'},classification:{type:'string',enum:['routine','concerning','urgent','uncertain']},evidence:{type:'array',items:{type:'string'}},uncertainty:{type:'string',enum:['low','medium','high']},requires_human_review:{type:'boolean'}},required:['detected_language','transcript','classification','evidence','uncertainty','requires_human_review']};
const system=`You are a safety-first post-discharge intake and triage assistant. You are not a diagnosing or prescribing clinician. Use only the patient answers and supplied hospital protocol. Never invent symptoms, diagnoses, medications, vitals, tests, or facts. If information is incomplete, ambiguous, conflicting, or unsupported by the protocol, classify uncertain and require human review. If a protocol safety trigger is present, do not downgrade it. Output only the requested JSON.`;
function fallback(text){return {detected_language:'en',transcript:text||'',classification:'uncertain',evidence:['Gemini API is not configured; no clinical automation was performed.'],uncertainty:'high',requires_human_review:true};}
export async function assess({answerText,audioPath,audioMimeType='audio/webm',protocolText}){
 if(!ai)return fallback(answerText);
 let input=[];
 if(audioPath){const f=await ai.files.upload({file:audioPath,config:{mimeType:audioMimeType}});input=[createPartFromUri(f.uri,f.mimeType),`Hospital protocol:\n${protocolText}\n\n${system}\nAnalyze this patient voice answer.`];}
 else input=[`Hospital protocol:\n${protocolText}\n\n${system}\nPatient answer:\n${answerText}`];
 const r=await ai.models.generateContent({model:env.geminiModel,contents:createUserContent(input),config:{systemInstruction:system,responseMimeType:'application/json',responseSchema:schema,temperature:0}});
 try{return JSON.parse(r.text)}catch{return fallback(answerText);}
}
