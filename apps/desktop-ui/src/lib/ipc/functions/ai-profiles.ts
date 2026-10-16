import type { AiProfile, AiProject } from '@tyco/shared'

export interface AiProfilesFunctions {
  getAiVaultPath: { args: [] }
  openAiVaultDir: { args: [profileId?: string] }
  listAiProfiles: { args: [] }
  getAiProfile: { args: [id: string] }
  createAiProfile: { args: [profile: AiProfile, soul: string] }
  saveAiProfile: { args: [profile: AiProfile] }
  deleteAiProfile: { args: [id: string] }
  readProfileSoul: { args: [id: string] }
  writeProfileSoul: { args: [id: string, content: string] }
  listAiProjects: { args: [] }
  createAiProject: { args: [project: AiProject] }
  saveAiProject: { args: [project: AiProject] }
  deleteAiProject: { args: [id: string] }
}
