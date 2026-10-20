import { useToastStore } from '../stores/toast'

export default function useToast() {
  const { toastKey, toastText } = useToastStore()
  return { toastKey, toastText }
}
