// vite ?raw 导入：把文本文件作为字符串导入（用于内置提示词模板正文）
declare module '*.txt?raw' {
  const content: string
  export default content
}

declare module '*?raw' {
  const content: string
  export default content
}
