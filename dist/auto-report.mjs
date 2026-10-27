// The browser must remain open; durable pending reports resume after credentials are re-entered.
export class AutoReportQueue {
  constructor(save,generate,onChange){this.save=save;this.generate=generate;this.onChange=onChange;this.tasks=new Map();this.running=false;}
  add(participant,report){const key=participant+':'+report.trial_id;if(report.auto_state==='completed'){this.tasks.delete(key);return;}if(!this.tasks.has(key))this.tasks.set(key,{participant,report:structuredClone(report)});}
  async run(participant,credentials,retry=false){
    if(this.running||!credentials.consent||!credentials.code||credentials.code.startsWith('sk-'))return;
    this.running=true;
    try{for(const[key,task]of this.tasks){
      if(task.participant!==participant||task.report.auto_state==='failed'&&!retry)continue;
      const report=task.report;
      try{
        report.auto_state='generating';delete report.auto_error;this.onChange(task);
        await this.save(participant,report);
        if(!report.ai)report.ai=await this.generate(report,credentials);
        report.auto_state='completed';await this.save(participant,report);this.tasks.delete(key);this.onChange(task);
      }catch(e){report.auto_state='failed';report.auto_error=e.message;try{await this.save(participant,report);}catch{}this.onChange(task);}
    }}finally{this.running=false;}
  }
}
