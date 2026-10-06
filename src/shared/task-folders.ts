import { z } from 'zod'

export interface TaskFolder {
  id: string
  name: string
}

// One directory component, also safe to use as a ZIP directory on Windows.
export const taskFolderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (name) =>
      !/[\\/:*?"<>|\u0000-\u001f]/.test(name) &&
      !/[. ]$/.test(name) &&
      !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) &&
      name !== '.' &&
      name !== '..',
    '文件夹名称无效',
  )
