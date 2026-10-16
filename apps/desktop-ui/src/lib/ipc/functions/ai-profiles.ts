import type { AiProfile, AiProject, Chat } from '@tyco/shared'

export interface AiProfilesFunctions {
  listAiProfiles: { args: [] }
  saveAiProfile: { args: [profile: AiProfile] }
  deleteAiProfile: { args: [id: string] }
  readProfileSoul: { args: [id: string] }
  writeProfileSoul: { args: [id: string, content: string] }
  listAiProjects: { args: [] }
  saveAiProject: { args: [project: AiProject] }
  deleteAiProject: { args: [id: string] }
  pickExternalProjectFolder: { args: [] }
  listProfileChats: { args: [profileId: string] }
  getProfileChat: { args: [profileId: string, id: string] }
  saveProfileChat: { args: [profileId: string, chat: Chat] }
  renameProfileChat: { args: [profileId: string, id: string, title: string] }
  deleteProfileChat: { args: [profileId: string, id: string] }
  clearProfileChats: { args: [profileId: string] }
  searchProfileChats: { args: [profileId: string, query: string] }
}
