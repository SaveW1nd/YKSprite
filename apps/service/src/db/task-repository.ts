import { desc, eq } from 'drizzle-orm';
import type { DatabaseClient } from './client.js';
import { eventsTable, tasksTable } from './schema.js';
import type { EventRecord, TaskRecord } from '../automation/automation-store.js';

export class TaskRepository {
  constructor(private readonly database: DatabaseClient) {}

  listTasks() {
    return this.database.db.select().from(tasksTable).orderBy(desc(tasksTable.startedAt)).all() as TaskRecord[];
  }

  getTask(id: string) {
    return this.database.db.select().from(tasksTable).where(eq(tasksTable.id, id)).get() as TaskRecord | undefined;
  }

  upsertTask(task: TaskRecord) {
    this.database.db.insert(tasksTable).values(task).onConflictDoUpdate({
      target: tasksTable.id,
      set: task
    }).run();
  }

  listEvents() {
    const events = this.database.db.select().from(eventsTable).orderBy(desc(eventsTable.time)).all() as EventRecord[];
    return events.sort((left, right) => {
      if (left.time !== right.time) {
        return right.time.localeCompare(left.time);
      }

      return this.readSequence(right.id) - this.readSequence(left.id);
    });
  }

  addEvent(event: EventRecord) {
    this.database.db.insert(eventsTable).values({
      ...event,
      taskId: null,
      eventType: event.level
    }).run();
  }

  private readSequence(id: string) {
    const match = id.match(/(\d+)$/);
    return match ? Number(match[1]) : 0;
  }
}
