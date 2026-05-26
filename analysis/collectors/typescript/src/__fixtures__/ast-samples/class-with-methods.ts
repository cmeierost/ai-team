export class UserService {
  private users: Map<string, User> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  addUser(user: User): void {
    this.users.set(user.id, user);
    this.logger.log('User added');
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  removeUser(id: string): boolean {
    this.logger.log('Removing user');
    return this.users.delete(id);
  }
}

interface User { id: string; name: string; }
interface Logger { log(msg: string): void; }
