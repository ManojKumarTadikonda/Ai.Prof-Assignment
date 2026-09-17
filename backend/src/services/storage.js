import fs from 'node:fs';import path from 'node:path';import {v2 as cloudinary} from 'cloudinary';import {env} from '../config/env.js';
const configured=env.cloudinary.cloudName&&env.cloudinary.apiKey&&env.cloudinary.apiSecret;
if(configured)cloudinary.config({cloud_name:env.cloudinary.cloudName,api_key:env.cloudinary.apiKey,api_secret:env.cloudinary.apiSecret,secure:true});
export async function storeAudio(file,{hospitalId,patientId,outreachTaskId,questionId}){
 if(configured){const r=await cloudinary.uploader.upload(file.path,{resource_type:'video',type:'authenticated',folder:`careflow/${hospitalId}/${patientId}/${outreachTaskId}`,public_id:questionId,overwrite:true});fs.unlink(file.path,()=>{});return {provider:'cloudinary',assetId:r.public_id,secureUrl:r.secure_url,mimeType:file.mimetype,duration:r.duration,processingPath:file.path};}
 const ext=path.extname(file.originalname)||'.webm';const target=path.resolve('uploads',`${hospitalId}_${patientId}_${outreachTaskId}_${questionId}${ext}`);fs.renameSync(file.path,target);return {provider:'local',assetId:target,mimeType:file.mimetype,processingPath:target};
}
