import { useEffect } from 'react'

const POPUP_SELECTOR = '.ant-select-dropdown, .ant-dropdown'
const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/

type TouchGesture = {
  identifier: number
  lastX: number
  lastY: number
  scrollContainer: HTMLElement | null
}

function findScrollContainer(target: Element, popup: HTMLElement) {
  let element: Element | null = target

  while (element && popup.contains(element)) {
    if (element instanceof HTMLElement) {
      const { overflowY } = window.getComputedStyle(element)
      const hasScrollableContent =
        element.scrollHeight > element.clientHeight + 1

      if (SCROLLABLE_OVERFLOW.test(overflowY) && hasScrollableContent) {
        return element
      }
    }

    if (element === popup) break
    element = element.parentElement
  }

  return null
}

function findTouch(touches: TouchList, identifier: number) {
  for (let index = 0; index < touches.length; index += 1) {
    const touch = touches.item(index)
    if (touch?.identifier === identifier) return touch
  }

  return null
}

/**
 * 阻止移动端下拉浮层在无处可滚时，把滑动手势继续传递给页面。
 */
export function usePopupTouchScrollGuard() {
  useEffect(() => {
    let gesture: TouchGesture | null = null

    const handleTouchMove = (event: TouchEvent) => {
      if (!gesture || event.touches.length !== 1) return

      const touch = findTouch(event.touches, gesture.identifier)
      if (!touch) return

      const deltaX = touch.clientX - gesture.lastX
      const deltaY = touch.clientY - gesture.lastY
      gesture.lastX = touch.clientX
      gesture.lastY = touch.clientY

      if (Math.abs(deltaY) <= Math.abs(deltaX) || deltaY === 0) return

      const scrollContainer = gesture.scrollContainer
      if (!scrollContainer) {
        if (event.cancelable) event.preventDefault()
        return
      }

      const isAtTop = scrollContainer.scrollTop <= 0
      const isAtBottom =
        Math.ceil(scrollContainer.scrollTop + scrollContainer.clientHeight) >=
        scrollContainer.scrollHeight
      const isMovingPastTop = deltaY > 0 && isAtTop
      const isMovingPastBottom = deltaY < 0 && isAtBottom

      if ((isMovingPastTop || isMovingPastBottom) && event.cancelable) {
        event.preventDefault()
      }
    }

    const clearGesture = () => {
      gesture = null
      document.removeEventListener('touchmove', handleTouchMove, true)
    }

    const handleTouchStart = (event: TouchEvent) => {
      clearGesture()

      if (event.touches.length !== 1 || !(event.target instanceof Element)) {
        return
      }

      const popup = event.target.closest<HTMLElement>(POPUP_SELECTOR)
      if (!popup) return

      const touch = event.touches.item(0)
      if (!touch) return

      gesture = {
        identifier: touch.identifier,
        lastX: touch.clientX,
        lastY: touch.clientY,
        scrollContainer: findScrollContainer(event.target, popup),
      }

      // 仅在手势从下拉浮层开始时注册非 passive 监听，避免影响页面日常滚动性能。
      document.addEventListener('touchmove', handleTouchMove, {
        capture: true,
        passive: false,
      })
    }

    document.addEventListener('touchstart', handleTouchStart, {
      capture: true,
      passive: true,
    })
    document.addEventListener('touchend', clearGesture, true)
    document.addEventListener('touchcancel', clearGesture, true)

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, true)
      document.removeEventListener('touchmove', handleTouchMove, true)
      document.removeEventListener('touchend', clearGesture, true)
      document.removeEventListener('touchcancel', clearGesture, true)
    }
  }, [])
}
