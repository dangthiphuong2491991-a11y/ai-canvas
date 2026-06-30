// 资产生成配置：风格 + 资产类型 预设（名称 + 提示词），可在设置里增删改，节点上下拉选择
export interface NamedPrompt {
  name: string
  prompt: string
}

// 默认风格（对标「无垠视界」，提示词可在设置里改）
export const DEFAULT_STYLES: NamedPrompt[] = [
  { name: '无参考', prompt: '' },
  {
    name: '写实电影风格',
    prompt: ', masterpiece, best quality, 8K ultra HD, 电影级写实摄影，真实光影，细腻皮肤与材质质感，浅景深'
  },
  {
    name: '真实3D国漫风格',
    prompt: ', masterpiece, best quality, 8K ultra HD, 真实感3D渲染，国漫风格，精致建模与布料，柔和体积光'
  },
  {
    name: '皮克斯动画风格',
    prompt: ', masterpiece, best quality, 8K ultra HD, 皮克斯/3D动画电影风格，圆润可爱造型，柔和打光，鲜明色彩'
  },
  {
    name: '国产历史正剧风格',
    prompt: ', masterpiece, best quality, 8K ultra HD, 电影级国产历史正剧，考究服化道，沉稳厚重色调，自然光影'
  }
]

// 默认资产类型（对标「无垠视界」NanoBanana/Nano）
export const DEFAULT_ASSET_TYPES: NamedPrompt[] = [
  { name: '无参考', prompt: '' },
  {
    name: '人物三视图',
    prompt:
      '一张图，角色设定图，白色干净背景。同一角色的正面、侧面、背面三视图，全身，三个视角比例与造型完全一致，不要文字。'
  },
  {
    name: '人物设定图',
    prompt: '角色设定图，白色干净背景，全身，清晰展示服装与配饰细节，单一角色。'
  },
  {
    name: '分镜故事板',
    prompt: '电影分镜故事板，多格画面，标注景别与运镜，黑白或淡彩草图风格。'
  },
  {
    name: '人物对话6宫格',
    prompt: '同一组角色的 6 格连续对话分镜（2×3 宫格），保持角色与场景一致，体现表情与机位变化。'
  },
  {
    name: '人物对话9宫格',
    prompt: '同一组角色的 9 格连续对话分镜（3×3 宫格），保持角色与场景一致，体现表情与机位变化。'
  },
  {
    name: '人物对话12宫格',
    prompt: '同一组角色的 12 格连续对话分镜（3×4 宫格），保持角色与场景一致，体现表情与机位变化。'
  },
  {
    name: '故事情节6宫格',
    prompt: '6 格连续故事情节分镜（2×3 宫格），按时间推进，保持角色与场景一致。'
  },
  {
    name: '故事情节9宫格',
    prompt: '9 格连续故事情节分镜（3×3 宫格），按时间推进，保持角色与场景一致。'
  },
  {
    name: '故事情节12宫格',
    prompt: '12 格连续故事情节分镜（3×4 宫格），按时间推进，保持角色与场景一致。'
  },
  {
    name: '场景四视图',
    prompt: '同一场景的四个视角四宫格（2×2），无人物，保持风格、陈设与光线一致。'
  },
  {
    name: '场景六视图',
    prompt: '同一场景的六个视角六宫格（2×3），无人物，保持风格、陈设与光线一致。'
  }
]

// 把风格/资产类型预设拼到用户提示词上（资产类型在前作为主指令，风格作为后缀修饰）
export function composePrompt(userPrompt: string, stylePrompt: string, typePrompt: string): string {
  const parts: string[] = []
  if (typePrompt.trim()) parts.push(typePrompt.trim())
  if (userPrompt.trim()) parts.push(userPrompt.trim())
  let out = parts.join('\n')
  if (stylePrompt.trim()) out += (out ? ' ' : '') + stylePrompt.trim()
  return out
}
