import cron from 'node-cron';
import {OutreachTask} from '../models/index.js';
import {processQueueOnce} from './queueLogic.js';

export function startWorker(){
  if(String(process.env.AUTO_QUEUE_WORKER||'false').toLowerCase()!=='true') return;
  cron.schedule('*/2 * * * *',async()=>{
    try{await processQueueOnce();console.log('[QUEUE WORKER] processed queue');}
    catch(e){console.error('[QUEUE WORKER]',e);}
  });
}
