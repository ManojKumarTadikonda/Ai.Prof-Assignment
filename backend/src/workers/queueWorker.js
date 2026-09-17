import cron from 'node-cron';
import {processQueueOnce} from './queueLogic.js';

// Manual queue processing is enabled by default for the prototype so that
// the UI's "Start Queue" action is visible and deterministic during demos.
// Set AUTO_QUEUE_WORKER=true to also process the queue every 2 minutes.
export function startWorker(){
  if(String(process.env.AUTO_QUEUE_WORKER).toLowerCase()!=='true'){
    console.log('Queue worker disabled (manual Start Queue mode).');
    return;
  }
  cron.schedule('*/2 * * * *',async()=>{
    try{await processQueueOnce()}catch(e){console.error('queue worker',e)}
  });
  console.log('Queue worker enabled (2-minute polling).');
}
