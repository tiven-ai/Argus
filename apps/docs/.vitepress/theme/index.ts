import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import '@fontsource-variable/inter'
import './tokens.css'
import './console.css'
import Layout from './Layout.vue'

export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme
