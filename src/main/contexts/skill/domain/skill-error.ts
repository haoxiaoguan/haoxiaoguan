// SkillError -- domain error type for the skill context.

export class SkillError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_FOUND'
      | 'ALREADY_INSTALLED'
      | 'FILESYSTEM'
      | 'NETWORK'
      | 'SERIALIZATION'
      | 'AGENT'
      | 'REPOSITORY'
      | 'UNKNOWN',
  ) {
    super(message)
    this.name = 'SkillError'
  }

  static notFound(id: string): SkillError {
    return new SkillError(`skill not found: '${id}'`, 'NOT_FOUND')
  }

  static alreadyInstalled(directory: string): SkillError {
    return new SkillError(`skill already installed: '${directory}'`, 'ALREADY_INSTALLED')
  }

  static filesystem(path: string, cause: Error): SkillError {
    return new SkillError(`filesystem error at '${path}': ${cause.message}`, 'FILESYSTEM')
  }

  static network(msg: string): SkillError {
    return new SkillError(`network error: ${msg}`, 'NETWORK')
  }

  static serialization(msg: string): SkillError {
    return new SkillError(`serialization error: ${msg}`, 'SERIALIZATION')
  }

  static agent(msg: string): SkillError {
    return new SkillError(`agent error: ${msg}`, 'AGENT')
  }

  static repository(msg: string): SkillError {
    return new SkillError(`repository error: ${msg}`, 'REPOSITORY')
  }
}
