import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
const dir=path.resolve('uploads');fs.mkdirSync(dir,{recursive:true});
export const audioUpload=multer({dest:dir,fileFilter:(req,file,cb)=>{if(file.mimetype.startsWith('audio/'))cb(null,true);else cb(new Error('Only audio files are accepted'));},limits:{fileSize:15*1024*1024}});
