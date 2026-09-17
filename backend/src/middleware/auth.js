import jwt from 'jsonwebtoken';
import {env} from '../config/env.js';
import {User} from '../models/index.js';
export async function auth(req,res,next){try{const h=req.headers.authorization||'';const token=h.startsWith('Bearer ')?h.slice(7):null;if(!token)return res.status(401).json({message:'Unauthorized'});const p=jwt.verify(token,env.jwtSecret);const u=await User.findById(p.userId).lean();if(!u||!u.active)return res.status(401).json({message:'Invalid user'});req.user=u;next();}catch(e){res.status(401).json({message:'Invalid token'});}}
export function roles(...allowed){return (req,res,next)=>allowed.includes(req.user.role)?next():res.status(403).json({message:'Forbidden'});}
export function tenantScope(req){return req.user.role==='PLATFORM_ADMIN'?{}:{hospitalId:req.user.hospitalId};}
