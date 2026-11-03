// node hash.mjs <salt> : prints HMAC-SHA256(salt, cwd)[:16] for the fixture folders
import c from 'node:crypto';
const salt = process.argv[2];
const bs = String.fromCharCode(92);
for (const p of [['C:', 'Users', 'dev', 'proj0'].join(bs), ['D:', 'work', 'ünï 项目'].join(bs), ['C:', 'Users', 'dev', 'ünïcødé 项目', 'app'].join(bs), '/old/proj'])
  console.log(JSON.stringify(p), c.createHmac('sha256', salt).update(p).digest('hex').slice(0, 16));
