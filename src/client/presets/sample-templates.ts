import samples from '../../../data-template/templates.json'
import type { TaskTemplate } from '../../server/common/template-manager'
import type { AppLanguage } from '../i18n'

const englishSamples = [
  {
    title: 'Sample template: Anime poster',
    prompt: 'Create a dramatic, high-impact double-exposure anime poster inspired by Revue Starlight. A huge character profile forms the central silhouette, calm and resolute with a sense of sacrifice. Inside the silhouette, build an expansive fantasy world drawn entirely from the series: its settings, architecture, props, lore, creatures, and landscapes. Place several key characters across the middle, their heroic poses and intersecting gazes suggesting an ensemble story and converging fates. Keep each character recognizably accurate. Combine Japanese anime illustration, cinematic concept-poster art, game key art, ink washes, and digital painting. Layer dense detail, penetrating light, moving smoke, flying fragments, swirling energy, warm-cool contrast, and deep space. Let the series\' own visual identity guide the palette. The finished image should feel like a collectible film poster: breathtaking, beautiful, tragic, fiery, and epic, with a complete composition, a strong focal point, and emotional storytelling.',
  },
  {
    title: 'Sample template: Character reaction sheet',
    prompt: 'Remove the speech bubble and make a 3×3 reaction sheet featuring the character in the reference image. Keep distinctive features accurate, including the green leaf on the head and the facial fur markings. The nine reactions are happy, goofy, sticking out the tongue, angry, sad, anxious, upside down, dreamcore, and mistaken. Keep the overall look funny, charmingly silly, and cute. Include no text.',
  },
] as const

/** Show seeded examples in English only while their original content is intact. */
export function localizeSampleTemplate(template: TaskTemplate, language: AppLanguage): TaskTemplate {
  if (language !== 'en-US') return template
  if (template.title === '模板示例1' && template.prompt === '生成一张2030年福瑞（furry）科目的中考试卷') {
    return {
      ...template,
      title: 'Sample template 1',
      prompt: 'Create a 2030 middle-school entrance exam paper with furry studies as one of the subjects.',
    }
  }
  const index = samples.findIndex((sample) => sample.id === template.id)
  if (index < 0) return template
  const source = samples[index]
  const translated = englishSamples[index]
  return {
    ...template,
    title: template.title === source.title ? translated.title : template.title,
    prompt: template.prompt === source.prompt ? translated.prompt : template.prompt,
  }
}
