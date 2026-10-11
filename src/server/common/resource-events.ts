import { EventEmitter } from 'events'

export type ResourceName = 'tasks' | 'templates' | 'images' | 'pending-images' | 'studio'
const events = new EventEmitter()
events.setMaxListeners(0)
const revisions = new Map<ResourceName, number>()

export const resourceRevision = (resource: ResourceName) => revisions.get(resource) ?? 0
export function publishResource(resource: ResourceName) {
  const revision = resourceRevision(resource) + 1
  revisions.set(resource, revision)
  events.emit('change', { resource, revision })
}
export function subscribeResources(listener: (event: { resource: ResourceName; revision: number }) => void) {
  events.on('change', listener)
  return () => { events.off('change', listener) }
}
