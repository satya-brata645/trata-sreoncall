// Lifecycle hook (§3). A shared event bus other things subscribe to —
// skills/author.js listens for "incident.resolved" to close the
// self-authoring loop; the surface listens for everything to keep its
// record of work up to date.
const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(50);

module.exports = bus;
