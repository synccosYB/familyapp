// Nightly backup inside the API process: a pg_dump into $FAMILYE_DATA/backups when the newest is older than 23 h.
// Keeps 14 days (always the newest 3). Checked hourly and 30 s after start.
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { runLearningReminders } from './learning-reminders.js';
import { runInvitationEmails } from './invitation-emails.js';
import { config } from './config.js';

export function startJobs(log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void }) {
  let reminding = false;
  const remind = async () => {
    if (reminding) return;
    reminding = true;
    try { await runLearningReminders(log); } catch(e) { log.error({error:String(e)}, 'learning reminder job failed'); }
    finally { reminding = false; }
  };
  setTimeout(remind, 5000).unref();
  setInterval(remind, 5 * 60000).unref();
  let inviting=false;
  const invitations=async()=>{if(inviting)return;inviting=true;try{await runInvitationEmails(log);}catch(e){log.error({error:String(e)},'Invitation email job failed');}finally{inviting=false;}};
  setInterval(invitations,2000).unref();
  const dir = path.resolve(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const run = () => {
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.dump')).map((f) => ({ f, t: statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      if (files[0] && Date.now() - files[0].t < 23 * 3600e3) return;
      const out = path.join(dir, `familye-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}.dump`);
      const p = spawn(config.pgDumpBin, ['-Fc', '--no-owner', '-d', config.databaseUrl, '-f', out + '.part'], { stdio: 'ignore' });
      p.on('exit', (code) => {
        if (code === 0) { renameSync(out + '.part', out); log.info({ out }, 'nightly backup written'); }
        else { try { unlinkSync(out + '.part'); } catch { /* */ } log.error({ code }, 'backup failed'); }
        files.slice(3).forEach(({ f, t }) => { if (Date.now() - t > 14 * 86400e3) try { unlinkSync(path.join(dir, f)); } catch { /* */ } });
      });
      p.on('error', (e) => log.error({ e: String(e) }, 'backup spawn failed'));
    } catch (e) { log.error({ e: String(e) }, 'backup check failed'); }
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, 3600e3).unref();
}
