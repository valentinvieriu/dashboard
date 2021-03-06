//
// SPDX-FileCopyrightText: 2020 SAP SE or an SAP affiliate company and Gardener contributors
//
// SPDX-License-Identifier: Apache-2.0
//

import Vue from 'vue'
import assign from 'lodash/assign'
import forEach from 'lodash/forEach'
import pick from 'lodash/pick'
import omit from 'lodash/omit'
import map from 'lodash/map'
import get from 'lodash/get'
import replace from 'lodash/replace'
import transform from 'lodash/transform'
import isEqual from 'lodash/isEqual'
import isObject from 'lodash/isObject'
import orderBy from 'lodash/orderBy'
import toLower from 'lodash/toLower'
import padStart from 'lodash/padStart'
import filter from 'lodash/filter'
import includes from 'lodash/includes'
import some from 'lodash/some'
import split from 'lodash/split'
import join from 'lodash/join'
import set from 'lodash/set'
import head from 'lodash/head'
import sample from 'lodash/sample'
import isEmpty from 'lodash/isEmpty'
import cloneDeep from 'lodash/cloneDeep'
import semver from 'semver'
import store from '../'
import { getShootInfo, getShootSeedInfo, createShoot, deleteShoot } from '@/utils/api'
import { getSpecTemplate, getDefaultZonesNetworkConfiguration, getControlPlaneZone } from '@/utils/createShoot'
import { isNotFound } from '@/utils/error'
import {
  isShootStatusHibernated,
  isReconciliationDeactivated,
  isStatusProgressing,
  getCreatedBy,
  getProjectName,
  shootHasIssue,
  purposesForSecret,
  shortRandomString,
  shootAddonList,
  utcMaintenanceWindowFromLocalBegin,
  randomLocalMaintenanceBegin,
  generateWorker
} from '@/utils'
import { isUserError, errorCodesFromArray } from '@/utils/errorCodes'

const uriPattern = /^([^:/?#]+:)?(\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?/

const keyForShoot = ({ name, namespace }) => {
  return `${name}_${namespace}`
}

const findItem = ({ name, namespace }) => {
  return state.shoots[keyForShoot({ name, namespace })]
}

// initial state
const state = {
  shoots: {},
  sortedShoots: [],
  filteredAndSortedShoots: [],
  sortParams: undefined,
  searchValue: undefined,
  selection: undefined,
  shootListFilters: undefined,
  newShootResource: undefined,
  initialNewShootResource: undefined
}

// getters
const getters = {
  sortedItems () {
    return state.filteredAndSortedShoots
  },
  itemByNameAndNamespace () {
    return ({ namespace, name }) => {
      return findItem({ name, namespace })
    }
  },
  selectedItem () {
    if (state.selection) {
      return findItem(state.selection)
    }
  },
  getShootListFilters () {
    return state.shootListFilters
  },
  newShootResource () {
    return state.newShootResource
  },
  initialNewShootResource () {
    return state.initialNewShootResource
  },
  keyForItem () {
    return keyForShoot
  }
}

// actions
const actions = {
  /**
   * Return all shoots in the given namespace.
   * This ends always in a server/backend call.
   */
  clearAll ({ commit, dispatch }) {
    commit('CLEAR_ALL')
    return getters.items
  },
  create ({ dispatch, commit, rootState }, data) {
    const namespace = data.metadata.namespace || rootState.namespace
    return createShoot({ namespace, data })
  },
  delete ({ dispatch, commit, rootState }, { name, namespace }) {
    return deleteShoot({ namespace, name })
  },
  /**
   * Return the given info for a single shoot with the namespace/name.
   * This ends always in a server/backend call.
   */
  async getInfo ({ commit, rootState }, { name, namespace }) {
    try {
      const { data: info } = await getShootInfo({ namespace, name })
      if (info.serverUrl) {
        const [, scheme, host] = uriPattern.exec(info.serverUrl)
        const authority = `//${replace(host, /^\/\//, '')}`
        const pathname = info.dashboardUrlPath
        info.dashboardUrl = [scheme, authority, pathname].join('')
        info.dashboardUrlText = [scheme, host].join('')
      }

      if (info.seedShootIngressDomain) {
        const baseHost = info.seedShootIngressDomain
        info.grafanaUrlUsers = `https://gu-${baseHost}`
        info.grafanaUrlOperators = `https://go-${baseHost}`

        info.prometheusUrl = `https://p-${baseHost}`

        info.alertmanagerUrl = `https://au-${baseHost}`
      }
      commit('RECEIVE_INFO', { name, namespace, info })
      return info
    } catch (error) {
      // shoot info not found -> ignore if KubernetesError
      if (isNotFound(error)) {
        return
      }
      throw error
    }
  },
  async getSeedInfo ({ commit, rootState }, { name, namespace }) {
    try {
      const { data: info } = await getShootSeedInfo({ namespace, name })
      commit('RECEIVE_SEED_INFO', { name, namespace, info })
      return info
    } catch (error) {
      // shoot seed info not found -> ignore if KubernetesError
      if (isNotFound(error)) {
        return
      }
      throw error
    }
  },
  setSelection ({ commit, dispatch }, metadata) {
    if (!metadata) {
      return commit('SET_SELECTION', null)
    }
    const item = findItem(metadata)
    if (item) {
      commit('SET_SELECTION', pick(metadata, ['namespace', 'name']))
      if (!item.info) {
        return dispatch('getInfo', { name: metadata.name, namespace: metadata.namespace })
      }
    }
  },
  setListSortParams ({ commit, rootState }, options) {
    const sortParams = pick(options, ['sortBy', 'sortDesc'])
    if (!isEqual(sortParams, state.sortParams)) {
      commit('SET_SORTPARAMS', { rootState, sortParams })
    }
  },
  setListSearchValue ({ commit, rootState }, searchValue) {
    if (!isEqual(searchValue, state.searchValue)) {
      commit('SET_SEARCHVALUE', { rootState, searchValue })
    }
  },
  setShootListFilters ({ commit, rootState }, value) {
    commit('SET_SHOOT_LIST_FILTERS', { rootState, value })
    return state.shootListFilters
  },
  setShootListFilter ({ commit, rootState }, filterValue) {
    if (state.shootListFilters) {
      commit('SET_SHOOT_LIST_FILTER', { rootState, filterValue })
      return state.shootListFilters
    }
  },
  setNewShootResource ({ commit }, data) {
    commit('SET_NEW_SHOOT_RESOURCE', { data })

    return state.newShootResource
  },
  resetNewShootResource ({ commit, rootState, rootGetters }) {
    const shootResource = {
      apiVersion: 'core.gardener.cloud/v1beta1',
      kind: 'Shoot',
      metadata: {
        namespace: rootState.namespace
      }
    }

    const infrastructureKind = head(rootGetters.sortedCloudProviderKindList)
    set(shootResource, 'spec', getSpecTemplate(infrastructureKind))

    const cloudProfileName = get(head(rootGetters.cloudProfilesByCloudProviderKind(infrastructureKind)), 'metadata.name')
    set(shootResource, 'spec.cloudProfileName', cloudProfileName)

    const secret = head(rootGetters.infrastructureSecretsByCloudProfileName(cloudProfileName))
    set(shootResource, 'spec.secretBindingName', get(secret, 'metadata.name'))

    let region = head(rootGetters.regionsWithSeedByCloudProfileName(cloudProfileName))
    if (!region) {
      const seedDeterminationStrategySameRegion = rootState.cfg.seedCandidateDeterminationStrategy === 'SameRegion'
      if (!seedDeterminationStrategySameRegion) {
        region = head(rootGetters.regionsWithoutSeedByCloudProfileName(cloudProfileName))
      }
    }
    set(shootResource, 'spec.region', region)

    const loadBalancerProviderName = head(rootGetters.loadBalancerProviderNamesByCloudProfileNameAndRegion({ cloudProfileName, region }))
    if (!isEmpty(loadBalancerProviderName)) {
      set(shootResource, 'spec.provider.controlPlaneConfig.loadBalancerProvider', loadBalancerProviderName)
    }
    const secretDomain = get(secret, 'data.domainName')
    const floatingPoolName = head(rootGetters.floatingPoolNamesByCloudProfileNameAndRegionAndDomain({ cloudProfileName, region, secretDomain }))
    if (!isEmpty(floatingPoolName)) {
      set(shootResource, 'spec.provider.infrastructureConfig.floatingPoolName', floatingPoolName)
    }

    const allLoadBalancerClassNames = rootGetters.loadBalancerClassNamesByCloudProfileName(cloudProfileName)
    if (!isEmpty(allLoadBalancerClassNames)) {
      const defaultLoadBalancerClassName = includes(allLoadBalancerClassNames, 'default')
        ? 'default'
        : head(allLoadBalancerClassNames)
      const loadBalancerClasses = [{
        name: defaultLoadBalancerClassName
      }]
      set(shootResource, 'spec.provider.controlPlaneConfig.loadBalancerClasses', loadBalancerClasses)
    }

    const partitionIDs = rootGetters.partitionIDsByCloudProfileNameAndRegion({ cloudProfileName, region })
    const partitionID = head(partitionIDs)
    if (!isEmpty(partitionID)) {
      set(shootResource, 'spec.provider.infrastructureConfig.partitionID', partitionID)
    }
    const firewallImages = rootGetters.firewallImagesByCloudProfileName(cloudProfileName)
    const firewallImage = head(firewallImages)
    if (!isEmpty(firewallImage)) {
      set(shootResource, 'spec.provider.infrastructureConfig.firewall.image', firewallImage)
    }
    const firewallSizes = map(rootGetters.firewallSizesByCloudProfileNameAndRegionAndZones({ cloudProfileName, region, zones: [partitionID] }), 'name')
    const firewallSize = head(firewallSizes)
    if (!isEmpty(firewallSize)) {
      set(shootResource, 'spec.provider.infrastructureConfig.firewall.size', firewallImage)
    }
    const allFirewallNetworks = rootGetters.firewallNetworksByCloudProfileNameAndPartitionId({ cloudProfileName, partitionID })
    const firewallNetworks = find(allFirewallNetworks, { key: 'internet' })
    if (!isEmpty(firewallNetworks)) {
      set(shootResource, 'spec.provider.infrastructureConfig.firewall.networks', firewallNetworks)
    }

    const name = shortRandomString(10)
    set(shootResource, 'metadata.name', name)

    const purpose = head(purposesForSecret(secret))
    set(shootResource, 'spec.purpose', purpose)

    const kubernetesVersion = rootGetters.defaultKubernetesVersionForCloudProfileName(cloudProfileName) || {}
    set(shootResource, 'spec.kubernetes.version', kubernetesVersion.version)

    const allZones = rootGetters.zonesByCloudProfileNameAndRegion({ cloudProfileName, region })
    const zones = allZones.length ? [sample(allZones)] : undefined
    const zonesNetworkConfiguration = getDefaultZonesNetworkConfiguration(zones, infrastructureKind, allZones.length)
    if (zonesNetworkConfiguration) {
      set(shootResource, 'spec.provider.infrastructureConfig.networks.zones', zonesNetworkConfiguration)
    }

    const worker = omit(generateWorker(zones, cloudProfileName, region), ['id'])
    const workers = [worker]
    set(shootResource, 'spec.provider.workers', workers)

    const controlPlaneZone = getControlPlaneZone(workers, infrastructureKind)
    if (controlPlaneZone) {
      set(shootResource, 'spec.provider.controlPlaneConfig.zone', controlPlaneZone)
    }

    const addons = {}
    forEach(filter(shootAddonList, addon => addon.visible), addon => {
      set(addons, [addon.name, 'enabled'], addon.enabled)
    })

    set(shootResource, 'spec.addons', addons)

    const { utcBegin, utcEnd } = utcMaintenanceWindowFromLocalBegin({ localBegin: randomLocalMaintenanceBegin(), timezone: rootState.localTimezone })
    const maintenance = {
      timeWindow: {
        begin: utcBegin,
        end: utcEnd
      },
      autoUpdate: {
        kubernetesVersion: true,
        machineImageVersion: true
      }
    }
    set(shootResource, 'spec.maintenance', maintenance)

    let hibernationSchedule = get(rootState.cfg.defaultHibernationSchedule, purpose)
    hibernationSchedule = map(hibernationSchedule, schedule => {
      return {
        ...schedule,
        location: rootState.localTimezone
      }
    })
    set(shootResource, 'spec.hibernation.schedules', hibernationSchedule)

    commit('RESET_NEW_SHOOT_RESOURCE', shootResource)
    return state.newShootResource
  }
}

// Deep diff between two object, using lodash
const difference = (object, base) => {
  function changes (object, base) {
    return transform(object, function (result, value, key) {
      if (!isEqual(value, base[key])) {
        result[key] = (isObject(value) && isObject(base[key])) ? changes(value, base[key]) : value
      }
    })
  }
  return changes(object, base)
}

const getRawVal = (item, column) => {
  const metadata = item.metadata
  const spec = item.spec
  switch (column) {
    case 'purpose':
      return get(spec, 'purpose')
    case 'lastOperation':
      return get(item, 'status.lastOperation')
    case 'createdAt':
      return metadata.creationTimestamp
    case 'createdBy':
      return getCreatedBy(metadata)
    case 'project':
      return getProjectName(metadata)
    case 'k8sVersion':
      return get(spec, 'kubernetes.version')
    case 'infrastructure':
      return `${get(spec, 'provider.type')} ${get(spec, 'region')}`
    case 'seed':
      return get(item, 'spec.seedName')
    case 'ticketLabels': {
      const labels = store.getters.ticketsLabels(metadata)
      return join(map(labels, 'name'), ' ')
    }
    default:
      return metadata[column]
  }
}

const getSortVal = (item, sortBy) => {
  const value = getRawVal(item, sortBy)
  const status = item.status
  switch (sortBy) {
    case 'purpose':
      switch (value) {
        case 'infrastructure':
          return 0
        case 'production':
          return 1
        case 'development':
          return 2
        case 'evaluation':
          return 3
        default:
          return 4
      }
    case 'lastOperation': {
      const operation = value || {}
      const inProgress = operation.progress !== 100 && operation.state !== 'Failed' && !!operation.progress
      const lastErrors = get(item, 'status.lastErrors', [])
      const isError = operation.state === 'Failed' || lastErrors.length
      const allErrorCodes = errorCodesFromArray(lastErrors)
      const userError = isUserError(allErrorCodes)
      const ignoredFromReconciliation = isReconciliationDeactivated(get(item, 'metadata', {}))

      if (ignoredFromReconciliation) {
        if (isError) {
          return 400
        } else {
          return 450
        }
      } else if (userError && !inProgress) {
        return 200
      } else if (userError && inProgress) {
        const progress = padStart(operation.progress, 2, '0')
        return `3${progress}`
      } else if (isError && !inProgress) {
        return 0
      } else if (isError && inProgress) {
        const progress = padStart(operation.progress, 2, '0')
        return `1${progress}`
      } else if (inProgress) {
        const progress = padStart(operation.progress, 2, '0')
        return `6${progress}`
      } else if (isShootStatusHibernated(status)) {
        return 500
      }
      return 700
    }
    case 'readiness': {
      const errorConditions = filter(get(status, 'conditions'), condition => get(condition, 'status') !== 'True')
      const lastErrorTransitionTime = head(orderBy(map(errorConditions, 'lastTransitionTime')))
      return lastErrorTransitionTime
    }
    case 'ticket': {
      const { namespace, name } = item.metadata
      return store.getters.latestUpdatedTicketByNameAndNamespace({ namespace, name })
    }
    default:
      return toLower(value)
  }
}

const shoots = (state) => {
  return map(Object.keys(state.shoots), (key) => state.shoots[key])
}

const setSortedItems = (state, rootState) => {
  const sortBy = head(get(state, 'sortParams.sortBy'))
  const sortDesc = get(state, 'sortParams.sortDesc', [false])
  const sortOrder = head(sortDesc) ? 'desc' : 'asc'

  let sortedShoots = shoots(state)
  if (sortBy) {
    const sortbyNameAsc = (a, b) => {
      if (getRawVal(a, 'name') > getRawVal(b, 'name')) {
        return 1
      } else if (getRawVal(a, 'name') < getRawVal(b, 'name')) {
        return -1
      }
      return 0
    }
    const inverse = sortOrder === 'desc' ? -1 : 1
    switch (sortBy) {
      case 'k8sVersion': {
        sortedShoots.sort((a, b) => {
          const versionA = getRawVal(a, sortBy)
          const versionB = getRawVal(b, sortBy)

          if (semver.gt(versionA, versionB)) {
            return 1 * inverse
          } else if (semver.lt(versionA, versionB)) {
            return -1 * inverse
          } else {
            return sortbyNameAsc(a, b)
          }
        })
        break
      }
      case 'readiness': {
        sortedShoots.sort((a, b) => {
          const readinessA = getSortVal(a, sortBy)
          const readinessB = getSortVal(b, sortBy)

          if (readinessA === readinessB) {
            return sortbyNameAsc(a, b)
          } else if (!readinessA) {
            return 1
          } else if (!readinessB) {
            return -1
          } else if (readinessA > readinessB) {
            return 1 * inverse
          } else {
            return -1 * inverse
          }
        })
        break
      }
      default: {
        sortedShoots = orderBy(sortedShoots, [item => getSortVal(item, sortBy), 'metadata.name'], [sortOrder, 'asc'])
      }
    }
  }
  state.sortedShoots = sortedShoots
  setFilteredAndSortedItems(state, rootState)
}

const setFilteredAndSortedItems = (state, rootState) => {
  let items = state.sortedShoots
  if (state.searchValue) {
    const predicate = item => {
      let found = true
      forEach(state.searchValue, value => {
        if (includes(getRawVal(item, 'name'), value)) {
          return
        }
        if (includes(getRawVal(item, 'infrastructure'), value)) {
          return
        }
        if (includes(getRawVal(item, 'seed'), value)) {
          return
        }
        if (includes(getRawVal(item, 'project'), value)) {
          return
        }
        if (includes(getRawVal(item, 'createdBy'), value)) {
          return
        }
        if (includes(getRawVal(item, 'purpose'), value)) {
          return
        }
        if (includes(getRawVal(item, 'k8sVersion'), value)) {
          return
        }
        if (includes(getRawVal(item, 'ticketLabels'), value)) {
          return
        }
        found = false
      })
      return found
    }
    items = filter(items, predicate)
  }
  if (rootState.namespace === '_all' && rootState.onlyShootsWithIssues) {
    if (get(state, 'shootListFilters.progressing', false)) {
      const predicate = item => {
        return !isStatusProgressing(get(item, 'metadata', {}))
      }
      items = filter(items, predicate)
    }
    if (get(state, 'shootListFilters.userIssues', false)) {
      const predicate = item => {
        const lastErrors = get(item, 'status.lastErrors', [])
        const allLastErrorCodes = errorCodesFromArray(lastErrors)
        const conditions = get(item, 'status.conditions', [])
        const allConditionCodes = errorCodesFromArray(conditions)
        return !isUserError(allLastErrorCodes) && !isUserError(allConditionCodes)
      }
      items = filter(items, predicate)
    }
    if (get(state, 'shootListFilters.deactivatedReconciliation', false)) {
      const predicate = item => {
        return !isReconciliationDeactivated(get(item, 'metadata', {}))
      }
      items = filter(items, predicate)
    }
    if (get(state, 'shootListFilters.hideTicketsWithLabel', false)) {
      const predicate = item => {
        const hideClustersWithLabels = get(rootState.cfg, 'ticket.hideClustersWithLabels')
        if (!hideClustersWithLabels) {
          return true
        }

        const ticketsForCluster = store.getters.ticketsByNamespaceAndName(get(item, 'metadata', {}))
        if (!ticketsForCluster.length) {
          return true
        }

        const ticketsWithoutHideLabel = filter(ticketsForCluster, ticket => {
          const labelNames = map(get(ticket, 'data.labels'), 'name')
          const ticketHasHideLabel = some(hideClustersWithLabels, hideClustersWithLabel => includes(labelNames, hideClustersWithLabel))
          return !ticketHasHideLabel
        })
        return ticketsWithoutHideLabel.length > 0
      }
      items = filter(items, predicate)
    }
  }

  state.filteredAndSortedShoots = items
}

const putItem = (state, newItem) => {
  const item = findItem(newItem.metadata)
  if (item !== undefined) {
    if (item.metadata.resourceVersion !== newItem.metadata.resourceVersion) {
      const sortBy = get(state, 'sortParams.sortBy')
      let sortRequired = true
      if (sortBy === 'name' || sortBy === 'infrastructure' || sortBy === 'project' || sortBy === 'createdAt' || sortBy === 'createdBy') {
        sortRequired = false // these values cannot change
      } else if (sortBy !== 'lastOperation') { // don't check in this case as most put events will be lastOperation anyway
        const changes = difference(item, newItem)
        const sortBy = get(state, 'sortParams.sortBy')
        if (!getRawVal(changes, sortBy)) {
          sortRequired = false
        }
      }
      Vue.set(state.shoots, keyForShoot(item.metadata), assign(item, newItem))
      return sortRequired
    }
  } else {
    newItem.info = undefined // register property to ensure reactivity
    Vue.set(state.shoots, keyForShoot(newItem.metadata), newItem)
    return true
  }
}

const deleteItem = (state, deletedItem) => {
  const item = findItem(deletedItem.metadata)
  let sortRequired = false
  if (item !== undefined) {
    Vue.delete(state.shoots, keyForShoot(item.metadata))
    sortRequired = true
  }
  return sortRequired
}

// mutations
const mutations = {
  RECEIVE_INFO (state, { namespace, name, info }) {
    const item = findItem({ namespace, name })
    if (item !== undefined) {
      Vue.set(item, 'info', info)
    }
  },
  RECEIVE_SEED_INFO (state, { namespace, name, info }) {
    const item = findItem({ namespace, name })
    if (item !== undefined) {
      Vue.set(item, 'seedInfo', info)
    }
  },
  SET_SELECTION (state, metadata) {
    state.selection = metadata
  },
  SET_SORTPARAMS (state, { rootState, sortParams }) {
    state.sortParams = sortParams
    setSortedItems(state, rootState)
  },
  SET_SEARCHVALUE (state, { rootState, searchValue }) {
    if (searchValue && searchValue.length > 0) {
      state.searchValue = split(searchValue, ' ')
    } else {
      state.searchValue = undefined
    }
    setFilteredAndSortedItems(state, rootState)
  },
  ITEM_PUT (state, { newItem, rootState }) {
    const sortRequired = putItem(state, newItem)

    if (sortRequired) {
      setSortedItems(state, rootState)
    }
  },
  HANDLE_EVENTS (state, { rootState, events }) {
    let sortRequired = false
    forEach(events, event => {
      switch (event.type) {
        case 'ADDED':
        case 'MODIFIED':
          if (rootState.namespace !== '_all' ||
            !rootState.onlyShootsWithIssues ||
            rootState.onlyShootsWithIssues === shootHasIssue(event.object)) {
            // Do not add healthy shoots when onlyShootsWithIssues=true, this can happen when toggeling flag
            if (putItem(state, event.object)) {
              sortRequired = true
            }
          }
          break
        case 'DELETED':
          if (deleteItem(state, event.object)) {
            sortRequired = true
          }
          break
        default:
          console.error('undhandled event type', event.type)
      }
    })
    if (sortRequired) {
      setSortedItems(state, rootState)
    }
  },
  CLEAR_ALL (state) {
    state.shoots = {}
    state.sortedShoots = []
    state.filteredAndSortedShoots = []
  },
  SET_SHOOT_LIST_FILTERS (state, { rootState, value }) {
    state.shootListFilters = value
    setFilteredAndSortedItems(state, rootState)
  },
  SET_SHOOT_LIST_FILTER (state, { rootState, filterValue }) {
    const { filter, value } = filterValue
    state.shootListFilters[filter] = value
    setFilteredAndSortedItems(state, rootState)
  },
  SET_NEW_SHOOT_RESOURCE (state, { data }) {
    state.newShootResource = data
  },
  RESET_NEW_SHOOT_RESOURCE (state, shootResource) {
    state.newShootResource = shootResource
    state.initialNewShootResource = cloneDeep(shootResource)
  }
}

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
}
