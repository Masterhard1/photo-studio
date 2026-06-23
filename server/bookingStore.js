const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'data', 'bookings.db');
let db = null;

function getDb() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        service TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        comment TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(date, time)
      )
    `);
  }
  return db;
}

function listBookings() {
  return getDb().prepare('SELECT * FROM bookings ORDER BY date, time').all();
}

function addBooking({ clientName, phone, service, date, time, comment, source }) {
  try {
    const result = getDb()
      .prepare(`INSERT INTO bookings (client_name, phone, service, date, time, comment, source, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(clientName, phone, service, date, time, comment || '', source, new Date().toISOString());
    return getDb().prepare('SELECT * FROM bookings WHERE id = ?').get(result.lastInsertRowid);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      throw new Error('Это время уже занято — выберите другое');
    }
    throw err;
  }
}

function deleteBooking(id) {
  return getDb().prepare('DELETE FROM bookings WHERE id = ?').run(id).changes > 0;
}

module.exports = { listBookings, addBooking, deleteBooking };
