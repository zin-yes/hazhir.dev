export default class Logger {
  constructor(private readonly scope: string) {}

  public debug(message: string) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(`[${this.scope}] ${message}`)
    }
  }

  public error(message: string) {
    console.error(`[${this.scope}] ${message}`)
  }
}
