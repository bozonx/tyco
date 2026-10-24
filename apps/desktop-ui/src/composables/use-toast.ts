import { useToastStore } from '../stores/toast'

export default function useToast() {
  const { toastKey, toastText, toastError } = useToastStore()
  return { toastKey, toastText, toastError }
}
