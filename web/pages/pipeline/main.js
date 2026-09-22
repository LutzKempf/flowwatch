// The Pipeline page: the sidebar and the demo's banner and footer, then its polls. Each module beside this one has
// one job; events.js answers the operator, polls.js and gates.js keep the payloads fresh.
import './events.js';
import { GATE_POLL_MS, tickGates } from './gates.js';
import { loadSetup, tick, tickInbox, tickLanes } from './polls.js';

Nav.initNav(); // the sidebar, and which panel this address shows
renderDemo(Data.demo); // the demo says what it is (render.js); a live page has no demo

if (Data.demo)
  document.getElementById('footer-source').textContent =
    'A snapshot taken ' + new Date(Data.demo.snapshotAt).toISOString().slice(0, 10) + ' · no live data';

tick();
setInterval(tick, 2000); // polled; no WebSocket to keep open
tickLanes();
setInterval(tickLanes, 5000);
tickInbox();
setInterval(tickInbox, 2000);
tickGates();
setInterval(tickGates, GATE_POLL_MS);

loadSetup();
setInterval(loadSetup, 30000);
