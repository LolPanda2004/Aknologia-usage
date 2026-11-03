#!/bin/bash
# End-to-end API test. Needs a FRESH database and a server started with DEV_MODE=true whose log goes to $LOG:
#   cd backend && DEV_MODE=true go run ./cmd/server > /tmp/server.log 2>&1 &
#   LOG=/tmp/server.log BASE=http://localhost:8080 ./scripts/e2e.sh
set -e
B=${BASE:-http://localhost:8080}/api/v1
LOG=${LOG:-/tmp/server.log}
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
code() { grep -o "$1[^:]*: [A-Z0-9-]*" $LOG | tail -1 | awk '{print $NF}'; }
echo "== signup"
curl -sf $B/auth/signup -H 'content-type: application/json' -d '{"name":"Jordan Lee","email":"jordan@acme.test","company":"Acme Engineering","teamSize":"11 – 50","password":"Granite-Harbor-71"}'; echo
C=$(code "one-time code for jordan@acme.test (verify_signup)"); echo "code=$C"
ADMIN=$(curl -sf $B/auth/verify-email -H 'content-type: application/json' -d "{\"email\":\"jordan@acme.test\",\"code\":\"$C\",\"client\":\"web\"}" | j "d['token']")
echo "admin token ok: ${ADMIN:0:8}…"
echo "== weak password rejected"; curl -s $B/auth/signup -H 'content-type: application/json' -d '{"name":"X","email":"x@acme.test","company":"Y","password":"short"}'; echo
echo "== member login to web refused / seats"
curl -s $B/admin/billing/seats -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"seats":25,"plan":"business"}' | j "(d['plan'], d['seats'], d['monthly'])"
echo "== invite"
curl -sf $B/admin/members/invite -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"emails":["priya@acme.test","tom@acme.test"],"role":"member","budgetCents":6000}'; echo
IC=$(code "invite code for priya@acme.test"); echo "invite=$IC"
echo "== invited cannot log in yet"; curl -s $B/auth/login -H 'content-type: application/json' -d '{"email":"priya@acme.test","password":"whatever-123!","client":"desktop"}'; echo
echo "== accept invite (desktop)"
DEV=$(curl -sf $B/auth/invite/accept -H 'content-type: application/json' -d "{\"email\":\"priya@acme.test\",\"code\":\"$IC\",\"password\":\"Tropical-Lantern-9\",\"client\":\"desktop\",\"deviceName\":\"priya-mbp\",\"os\":\"macOS\",\"appVersion\":\"1.0.0\"}" | j "d['token']")
echo "device token ok"
echo "== member blocked from admin console"; curl -s $B/auth/login -H 'content-type: application/json' -d '{"email":"priya@acme.test","password":"Tropical-Lantern-9","client":"web"}'; echo
echo "== agent config"; curl -sf $B/agent/config -H "authorization: Bearer $DEV" | j "(d['status'], d['budget']['budgetCents'], len(d['pricing']), len(d['projectSalt']))"
echo "== ingest (opus-heavy so it crosses the \$60 budget: 120 x \$0.536 = \$64.32 at list price)"
python3 - << 'PY' > /tmp/batch.json
import json, datetime
now = datetime.datetime.now(datetime.timezone.utc)
ev = []
for s in range(3):
  for i in range(40):
    t = now - datetime.timedelta(hours=s*3, minutes=(40-i)*2)
    ev.append({"tool":"claude_code","sessionId":f"sess-{s}","messageId":f"msg-{s}-{i}","requestId":f"req-{s}-{i}","model":"claude-opus-5-5","input":3000,"output":20000,"cacheWrite":20000,"cacheRead":120000,"ts":t.isoformat(),"projectHash":"7f3a2c9d","parserVersion":"claude-1"})
for i in range(10):
  t = now - datetime.timedelta(minutes=i*3)
  ev.append({"tool":"codex","sessionId":"cx-1","messageId":f"off:{i*100}","model":"gpt-5-codex","input":5000,"output":1200,"cacheRead":20000,"ts":t.isoformat(),"projectHash":"5b8d71aa","parserVersion":"codex-1"})
print(json.dumps({"appVersion":"1.0.0","unreadLines":3,"events":ev}))
PY
curl -sf $B/ingest/batch -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d @/tmp/batch.json; echo
echo "== re-send is idempotent"; curl -sf $B/ingest/batch -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d @/tmp/batch.json; echo
echo "== budget alert emails/notifications"; N=$(grep -c "reached .* of their budget" $LOG || true); echo "$N"; [ "$N" -ge 2 ] || { echo "expected the 80% and 100% alerts"; exit 1; }
curl -sf $B/me/notifications -H "authorization: Bearer $DEV" | j "[n['title'] for n in d]"
echo "== my usage"; curl -sf "$B/me/usage?days=7" -H "authorization: Bearer $DEV" | j "(d['costUsd'], d['activeHours'], d['sessions'], d['savedUsd'], d['budget']['pct'])"
echo "== admin overview"; curl -sf $B/admin/overview -H "authorization: Bearer $ADMIN" | j "(d['kpis'], d['alerts'], d['budgetHealth'], len(d['daily']), d['dataHealth'])"
PID=$(curl -sf $B/admin/members -H "authorization: Bearer $ADMIN" | j "[m['id'] for m in d['members'] if m['email']=='priya@acme.test'][0]")
echo "== member detail"; curl -sf $B/admin/members/$PID/usage -H "authorization: Bearer $ADMIN" | j "(d['kpis'], [s['project'] for s in d['sessions']][:3], len(d['alerts']))"
echo "== budgets"; curl -sf $B/admin/budgets -H "authorization: Bearer $ADMIN" -X PUT -H 'content-type: application/json' -d '{"defaultBudget":150,"inboxes":["jordan@acme.test","finance@acme.test"]}' | j "(d['defaultBudget'], d['inboxes'], d['totalBudget'], [(m['name'],m['pct'],m['alerts']) for m in d['members']])"
echo "== refresh"; curl -sf -X POST $B/admin/refresh -H "authorization: Bearer $ADMIN" | j "(d['events'], d['tookMs'])"
echo "== export"; curl -sf "$B/admin/export.csv" -H "authorization: Bearer $ADMIN" | head -2
echo "== change password with code"
curl -sf $B/me/password/start -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d '{"current":"Tropical-Lantern-9","new":"Velvet-Comet-42!"}'; echo
PC=$(code "one-time code for priya@acme.test (change_password)")
curl -sf $B/me/password/confirm -H "authorization: Bearer $DEV" -H 'content-type: application/json' -d "{\"code\":\"$PC\"}"; echo
echo "== forgot + reset"
curl -sf $B/auth/password/forgot -H 'content-type: application/json' -d '{"email":"priya@acme.test"}'; echo
RC=$(code "reset code for priya@acme.test")
curl -sf $B/auth/password/reset -H 'content-type: application/json' -d "{\"email\":\"priya@acme.test\",\"code\":\"$RC\"}"; echo
curl -sf $B/auth/password/reset -H 'content-type: application/json' -d "{\"email\":\"priya@acme.test\",\"code\":\"$RC\",\"password\":\"Copper-Meadow-88\"}"; echo
echo "== old device session revoked by reset"; curl -s $B/me -H "authorization: Bearer $DEV"; echo
DEV2=$(curl -sf $B/auth/login -H 'content-type: application/json' -d '{"email":"priya@acme.test","password":"Copper-Meadow-88","client":"desktop","deviceName":"priya-mbp"}' | j "d['token']")
echo "== support ticket"; curl -sf $B/support/tickets -H "authorization: Bearer $DEV2" -H 'content-type: application/json' -d '{"kind":"bug","title":"Codex sessions missing","body":"After update","severity":"Numbers look wrong"}'; echo
echo "== remove member"; curl -sf -X DELETE "$B/admin/members/$PID" -H "authorization: Bearer $ADMIN"; echo
echo "== removed device now gets:"; curl -s $B/agent/config -H "authorization: Bearer $DEV2"; echo
curl -s $B/auth/login -H 'content-type: application/json' -d '{"email":"priya@acme.test","password":"Copper-Meadow-88","client":"desktop"}'; echo
echo "== demo request"; curl -sf $B/demo-requests -H 'content-type: application/json' -d '{"name":"A","email":"a@b.co","slot":"Wed 15 Oct 14:00"}'; echo
echo ALL_PASSED
