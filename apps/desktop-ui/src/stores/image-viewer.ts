import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ImageViewerRequest {
  src: string
  alt?: string
  lightSurface?: boolean
}

export const useImageViewerStore = defineStore('image-viewer', () => {
  const isOpen = ref(false)
  const src = ref('')
  const alt = ref('')
  const lightSurface = ref(false)

  function open(request: ImageViewerRequest) {
    if (!request.src) return
    src.value = request.src
    alt.value = request.alt ?? ''
    lightSurface.value = Boolean(request.lightSurface)
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
  }

  return { isOpen, src, alt, lightSurface, open, close }
})
