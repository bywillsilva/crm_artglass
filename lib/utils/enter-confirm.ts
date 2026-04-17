function isHtmlElement(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement
}

function isDisabled(element: HTMLElement) {
  return (
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.getAttribute('data-disabled') === 'true'
  )
}

export function shouldHandleEnterConfirm(event: {
  key: string
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  isComposing?: boolean
  defaultPrevented: boolean
  target: EventTarget | null
}) {
  if (
    event.key !== 'Enter' ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.isComposing
  ) {
    return false
  }

  if (!isHtmlElement(event.target)) {
    return true
  }

  const target = event.target

  if (
    target.closest('[data-disable-enter-confirm="true"]') ||
    target.closest('[data-slot="command"]') ||
    target.closest('[data-slot="select-content"]') ||
    target.closest('[role="listbox"]')
  ) {
    return false
  }

  if (
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'BUTTON' ||
    target.tagName === 'A' ||
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') ||
    target.closest('[data-slot="select-trigger"]') ||
    target.closest('[role="combobox"]')
  ) {
    return false
  }

  return true
}

export function triggerEnterConfirm(container: HTMLElement, target: EventTarget | null) {
  const activeTarget = isHtmlElement(target) ? target : null
  const ownerForm = activeTarget?.closest('form')

  if (ownerForm instanceof HTMLFormElement) {
    ownerForm.requestSubmit()
    return true
  }

  const explicitConfirm = container.querySelector<HTMLElement>('[data-enter-confirm="true"]')
  if (explicitConfirm && !isDisabled(explicitConfirm)) {
    explicitConfirm.click()
    return true
  }

  const submitButton = container.querySelector<HTMLElement>(
    'button[type="submit"], input[type="submit"]'
  )
  if (submitButton && !isDisabled(submitButton)) {
    submitButton.click()
    return true
  }

  const footerButtons = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-slot="dialog-footer"] button, [data-slot="alert-dialog-footer"] button'
    )
  ).filter((button) => !isDisabled(button))

  if (footerButtons.length >= 2) {
    footerButtons[footerButtons.length - 1]?.click()
    return true
  }

  return false
}
