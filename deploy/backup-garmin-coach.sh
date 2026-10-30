#!/bin/bash
# Independent online backup: never stop this app or any other homelab service.
set -euo pipefail
BACKUP_DIR="/mnt/backups/garmin-ai-coach"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if ! mountpoint -q /mnt/backups; then
    echo "Coach backup skipped: backup drive is not mounted." >&2
    exit 1
fi
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
flock -n 9 || exit 0
backup_name="$(docker exec garmin-ai-coach node -e '
const Database=require("better-sqlite3"),fs=require("node:fs");
(async()=>{
 const dir="/app/data/backups";fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const name="coach-"+new Date().toISOString().replace(/[:.]/g,"-")+".db";
 const source=new Database(process.env.DATABASE_PATH,{readonly:true,fileMustExist:true});
 try{await source.backup(dir+"/"+name);}finally{source.close();}
 fs.chmodSync(dir+"/"+name,0o600);
 const snapshot=new Database(dir+"/"+name,{fileMustExist:true});
 snapshot.pragma("journal_mode = DELETE");
 try{if(snapshot.pragma("integrity_check",{simple:true})!=="ok")throw Error("integrity check failed");}finally{snapshot.close();}
 const old=fs.readdirSync(dir).filter(n=>/^coach-[0-9TZ-]+\.db$/.test(n)).sort().reverse().slice(14);
 for(const n of old)fs.unlinkSync(dir+"/"+n);
 console.log(name);
})().catch(()=>{console.error("Coach online backup failed.");process.exitCode=1;});
')"
if [[ ! "$backup_name" =~ ^coach-[0-9TZ-]+\.db$ ]]; then
    echo "Unexpected coach backup filename." >&2
    exit 1
fi
docker cp "garmin-ai-coach:/app/data/backups/$backup_name" "$BACKUP_DIR/$backup_name.tmp" >/dev/null
chmod 0600 "$BACKUP_DIR/$backup_name.tmp"
mv "$BACKUP_DIR/$backup_name.tmp" "$BACKUP_DIR/$backup_name"
# Include only this app's deployment files and private environment.
cp "$SCRIPT_DIR/docker-compose.coach.yml" "$BACKUP_DIR/docker-compose.coach.yml"
cp "$SCRIPT_DIR/configs/garmin-ai-coach/coach.env" "$BACKUP_DIR/coach.env"
chmod 0600 "$BACKUP_DIR/coach.env"
python3 - "$BACKUP_DIR" <<'PY'
import pathlib,re,sys
folder=pathlib.Path(sys.argv[1])
files=sorted((p for p in folder.iterdir() if p.is_file() and re.fullmatch(r'coach-[0-9TZ-]+\.db',p.name)),reverse=True)
for old in files[14:]:old.unlink()
PY
printf 'Coach SQLite online backup verified: %s\n' "$BACKUP_DIR/$backup_name"
