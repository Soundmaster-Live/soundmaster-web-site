export class Database {
	constructor(env) {
	  this.env = env;
	}

	async getLogs() {
	  const logs = await this.env.DB.prepare('SELECT * FROM logs').all();
	  return logs.results || [];
	}

	async addLog(log) {
	  const logs = await this.getLogs();
	  logs.push(log);
	  await this.env.DB.prepare('INSERT INTO logs (timestamp, message) VALUES (?, ?)').bind(log.timestamp, log.message).run();
	}
  }
