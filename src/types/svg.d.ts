declare module '*.svg?raw' {
  const content: string;
  export default content;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
