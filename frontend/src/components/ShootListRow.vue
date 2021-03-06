<!--
SPDX-FileCopyrightText: 2020 SAP SE or an SAP affiliate company and Gardener contributors

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <tr>
    <td class="nowrap" v-if="this.headerVisible['project']">
      <router-link class="cyan--text text--darken-2" :to="{ name: 'ShootList', params: { namespace: shootNamespace } }">
        {{ shootProjectName }}
      </router-link>
    </td>
    <td class="nowrap" v-if="this.headerVisible['name']">
      <v-row align="center" class="pa-0 ma-0 fill-height flex-nowrap">
        <v-col class="grow pa-0 ma-0">
          <router-link class="cyan--text text--darken-2" :to="{ name: 'ShootItem', params: { name: shootName, namespace: shootNamespace } }">
            {{ shootName }}
          </router-link>
        </v-col>
        <v-col class="shrink" >
          <div class="d-flex flew-row" v-if="!isShootMarkedForDeletion">
            <self-termination-warning :expirationTimestamp="shootExpirationTimestamp"></self-termination-warning>
            <version-expiration-warning :shootItem="shootItem"></version-expiration-warning>
            <hibernation-schedule-warning
              v-if="isShootHasNoHibernationScheduleWarning"
              :name="shootName"
              :namespace="shootNamespace"
              :purpose="shootPurpose">
            </hibernation-schedule-warning>
          </div>
        </v-col>
      </v-row>
    </td>
    <td class="nowrap" v-if="this.headerVisible['infrastructure']">
      <vendor :shootItem="shootItem"></vendor>
    </td>
    <td class="nowrap" v-if="this.headerVisible['seed']">
      <shoot-seed-name :shootItem="shootItem" />
    </td>
    <td class="nowrap" v-if="this.headerVisible['technicalId']">
      <div class="d-flex align-center justify-start flex-nowrap fill-height">
        <span>{{shootTechnicalId}}</span>
        <copy-btn :clipboard-text="shootTechnicalId"></copy-btn>
      </div>
    </td>
    <td class="nowrap" v-if="this.headerVisible['createdBy']">
      <account-avatar :account-name="shootCreatedBy"></account-avatar>
    </td>
    <td class="nowrap" v-if="this.headerVisible['createdAt']">
      <v-tooltip top>
        <template v-slot:activator="{ on }">
          <div v-on="on">
            <time-string :date-time="shootCreationTimestamp" mode="past"></time-string>
          </div>
        </template>
        {{ shootCreatedAt }}
      </v-tooltip>
    </td>
    <td class="nowrap text-center" v-if="this.headerVisible['purpose']">
      <purpose-tag :purpose="shootPurpose"></purpose-tag>
    </td>
    <td class="text-left nowrap" v-if="this.headerVisible['lastOperation']">
      <div>
        <shoot-status
         :popperKey="`${shootNamespace}/${shootName}`"
         :shootItem="shootItem">
        </shoot-status>
      </div>
    </td>
    <td class="nowrap text-center" v-if="this.headerVisible['k8sVersion']">
      <shoot-version :shoot-item="shootItem" chip></shoot-version>
    </td>
    <td class="nowrap text-center" v-if="this.headerVisible['readiness']">
      <status-tags :shootItem="shootItem"></status-tags>
    </td>
    <td v-if="this.headerVisible['accessRestrictions']">
      <access-restriction-chips :selectedAccessRestrictions="shootSelectedAccessRestrictions"></access-restriction-chips>
    </td>
    <td class="nowrap" v-if="this.headerVisible['ticket']">
      <v-tooltip top>
        <template v-slot:activator="{ on }">
          <div v-on="on">
            <router-link class="cyan--text text--darken-2" :to="{ name: 'ShootItem', params: { name: shootName, namespace: shootNamespace } }">
              <time-string :date-time="shootLastUpdatedTicketTimestamp" mode="past"></time-string>
            </router-link>
          </div>
        </template>
        {{ shootLastUpdatedTicket }}
      </v-tooltip>
    </td>
    <td v-if="this.headerVisible['ticketLabels']">
      <template v-if="shootLastUpdatedTicketTimestamp && !shootTicketsLabels.length">
        None
      </template>
      <div class="labels" v-else>
        <ticket-label v-for="label in shootTicketsLabels" :key="label.id" :label="label"></ticket-label>
      </div>
    </td>
    <td class="action-button-group text-right nowrap" v-if="this.headerVisible['actions']">
      <v-row class="fill-height" align="center" justify="end" >
        <v-tooltip top v-if="canGetSecrets">
          <template v-slot:activator="{ on }">
            <div v-on="on">
              <v-btn small icon class="cyan--text text--darken-2" :disabled="isClusterAccessDialogDisabled" @click="showDialog('access')">
                <v-icon size="22">mdi-key</v-icon>
              </v-btn>
            </div>
          </template>
          <span>{{showClusterAccessActionTitle}}</span>
        </v-tooltip>
        <shoot-list-row-actions :shootItem="shootItem"></shoot-list-row-actions>
      </v-row>
    </td>
  </tr>
</template>

<script>
import { mapGetters } from 'vuex'
import forEach from 'lodash/forEach'
import includes from 'lodash/includes'

import AccessRestrictionChips from '@/components/ShootAccessRestrictions/AccessRestrictionChips'
import AccountAvatar from '@/components/AccountAvatar'
import CopyBtn from '@/components/CopyBtn'
import Vendor from '@/components/Vendor'
import ShootStatus from '@/components/ShootStatus'
import StatusTags from '@/components/StatusTags'
import PurposeTag from '@/components/PurposeTag'
import TimeString from '@/components/TimeString'
import ShootVersion from '@/components/ShootVersion/ShootVersion'
import TicketLabel from '@/components/ShootTickets/TicketLabel'
import SelfTerminationWarning from '@/components/SelfTerminationWarning'
import HibernationScheduleWarning from '@/components/ShootHibernation/HibernationScheduleWarning'
import ShootSeedName from '@/components/ShootSeedName'
import VersionExpirationWarning from '@/components/VersionExpirationWarning'
import ShootListRowActions from '@/components/ShootListRowActions'

import {
  isTypeDelete,
  isShootHasNoHibernationScheduleWarning,
  getTimestampFormatted
} from '@/utils'

import { shootItem } from '@/mixins/shootItem'

export default {
  components: {
    AccessRestrictionChips,
    StatusTags,
    PurposeTag,
    ShootStatus,
    TimeString,
    ShootVersion,
    TicketLabel,
    SelfTerminationWarning,
    HibernationScheduleWarning,
    AccountAvatar,
    CopyBtn,
    ShootSeedName,
    Vendor,
    VersionExpirationWarning,
    ShootListRowActions
  },
  props: {
    shootItem: {
      type: Object,
      required: true
    },
    visibleHeaders: {
      type: Array,
      required: true
    }
  },
  mixins: [shootItem],
  computed: {
    ...mapGetters([
      'latestUpdatedTicketByNameAndNamespace',
      'ticketsLabels',
      'canGetSecrets',
      'canDeleteShoots'
    ]),
    headerVisible () {
      const headerVisible = {}
      forEach(this.visibleHeaders, (header) => {
        headerVisible[header.value] = true
      })
      return headerVisible
    },
    isInfoAvailable () {
      // operator not yet updated shoot resource
      if (this.shootLastOperation.type === undefined || this.shootLastOperation.state === undefined) {
        return false
      }
      return !this.isCreateOrDeleteInProcess
    },
    isCreateOrDeleteInProcess () {
      // create or delete in process
      if (includes(['Create', 'Delete'], this.shootLastOperation.type) && this.shootLastOperation.state === 'Processing') {
        return true
      }
      return false
    },
    isTypeDelete () {
      return isTypeDelete(this.shootLastOperation)
    },
    isClusterAccessDialogDisabled () {
      if (this.shootInfo.dashboardUrl) {
        return false
      }
      if (this.shootInfo.kubeconfig) {
        return false
      }

      // disabled if info is NOT available
      return !this.isInfoAvailable
    },
    showClusterAccessActionTitle () {
      return this.isClusterAccessDialogDisabled
        ? 'Cluster Access'
        : 'Show Cluster Access'
    },
    isShootHasNoHibernationScheduleWarning () {
      return isShootHasNoHibernationScheduleWarning(this.shootItem)
    },
    shootLastUpdatedTicketTimestamp () {
      return this.latestUpdatedTicketByNameAndNamespace(this.shootMetadata)
    },
    shootLastUpdatedTicket () {
      return getTimestampFormatted(this.shootLastUpdatedTicketTimestamp)
    },
    shootTicketsLabels () {
      return this.ticketsLabels(this.shootMetadata)
    }
  },
  methods: {
    showDialog: function (action) {
      const shootItem = this.shootItem
      this.$emit('showDialog', { action, shootItem })
    }
  }
}
</script>
<style lang="scss" scoped>
  .labels {
    line-height: 10px;
  }

  .action-button-group {
    white-space: nowrap;

    button[type=button] {
      margin: 0 4px;
    }
  }

  .nowrap {
    white-space: nowrap;
  }
</style>
