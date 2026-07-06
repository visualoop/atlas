/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as ai_catalog from "../ai/catalog.js";
import type * as ai_providers from "../ai/providers.js";
import type * as ai_registry from "../ai/registry.js";
import type * as ai_router from "../ai/router.js";
import type * as aiHelpers from "../aiHelpers.js";
import type * as aiWorkflowHelpers from "../aiWorkflowHelpers.js";
import type * as aiWorkflows from "../aiWorkflows.js";
import type * as analytics from "../analytics.js";
import type * as analyticsActions from "../analyticsActions.js";
import type * as analyticsActionsHelpers from "../analyticsActionsHelpers.js";
import type * as apiUsage from "../apiUsage.js";
import type * as auth from "../auth.js";
import type * as automationEngine from "../automationEngine.js";
import type * as automationEngineHelpers from "../automationEngineHelpers.js";
import type * as broadcasts from "../broadcasts.js";
import type * as broadcastsDispatch from "../broadcastsDispatch.js";
import type * as calendar from "../calendar.js";
import type * as calendarActions from "../calendarActions.js";
import type * as calendarActionsHelpers from "../calendarActionsHelpers.js";
import type * as campaignRunner from "../campaignRunner.js";
import type * as campaignRunnerHelpers from "../campaignRunnerHelpers.js";
import type * as campaigns from "../campaigns.js";
import type * as cloudflareEmailRoutingActions from "../cloudflareEmailRoutingActions.js";
import type * as cloudflareEmailRoutingHelpers from "../cloudflareEmailRoutingHelpers.js";
import type * as coldOutreach from "../coldOutreach.js";
import type * as coldOutreachQueries from "../coldOutreachQueries.js";
import type * as companies from "../companies.js";
import type * as composio from "../composio.js";
import type * as composioActions from "../composioActions.js";
import type * as composioHelpers from "../composioHelpers.js";
import type * as contacts from "../contacts.js";
import type * as content from "../content.js";
import type * as copilot from "../copilot.js";
import type * as copilotAgent from "../copilotAgent.js";
import type * as copilotAgentKeys from "../copilotAgentKeys.js";
import type * as copilotHelpers from "../copilotHelpers.js";
import type * as crons from "../crons.js";
import type * as dailyBriefings from "../dailyBriefings.js";
import type * as dailyBriefingsHelpers from "../dailyBriefingsHelpers.js";
import type * as demoRecordings from "../demoRecordings.js";
import type * as demoRecordingsHelpers from "../demoRecordingsHelpers.js";
import type * as documents from "../documents.js";
import type * as documentsActions from "../documentsActions.js";
import type * as documentsActionsHelpers from "../documentsActionsHelpers.js";
import type * as documentsPdf from "../documentsPdf.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as emails from "../emails.js";
import type * as emailsInbound from "../emailsInbound.js";
import type * as emailsInboundFetch from "../emailsInboundFetch.js";
import type * as emailsInboundFetch_helpers from "../emailsInboundFetch_helpers.js";
import type * as emailsOut from "../emailsOut.js";
import type * as emailsOutHelpers from "../emailsOutHelpers.js";
import type * as emailsOutSystem from "../emailsOutSystem.js";
import type * as emailsOutSystemHelpers from "../emailsOutSystemHelpers.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as integrationsTests from "../integrationsTests.js";
import type * as integrationsTestsHelpers from "../integrationsTestsHelpers.js";
import type * as lib_agentPersona from "../lib/agentPersona.js";
import type * as lib_attribution from "../lib/attribution.js";
import type * as lib_authHelpers from "../lib/authHelpers.js";
import type * as lib_emailThread from "../lib/emailThread.js";
import type * as lib_orgMailer from "../lib/orgMailer.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_secretsAccess from "../lib/secretsAccess.js";
import type * as lib_systemMailer from "../lib/systemMailer.js";
import type * as lib_timeline from "../lib/timeline.js";
import type * as lib_tokenEstimate from "../lib/tokenEstimate.js";
import type * as lib_workspaceContext from "../lib/workspaceContext.js";
import type * as lib_workspaceContextAi from "../lib/workspaceContextAi.js";
import type * as mailer from "../mailer.js";
import type * as notes from "../notes.js";
import type * as notifications from "../notifications.js";
import type * as organizations from "../organizations.js";
import type * as outreachSuggestions from "../outreachSuggestions.js";
import type * as pageAgents from "../pageAgents.js";
import type * as pageAgentsHelpers from "../pageAgentsHelpers.js";
import type * as payments from "../payments.js";
import type * as paymentsActions from "../paymentsActions.js";
import type * as paymentsHelpers from "../paymentsHelpers.js";
import type * as pipelines from "../pipelines.js";
import type * as pipelinesActions from "../pipelinesActions.js";
import type * as prospector from "../prospector.js";
import type * as prospectorActions from "../prospectorActions.js";
import type * as prospectorAutoRank from "../prospectorAutoRank.js";
import type * as prospectorEnrich from "../prospectorEnrich.js";
import type * as prospectorEnrichHelpers from "../prospectorEnrichHelpers.js";
import type * as prospectorHelpers from "../prospectorHelpers.js";
import type * as prospectorOsm from "../prospectorOsm.js";
import type * as prospectorOsmHelpers from "../prospectorOsmHelpers.js";
import type * as prospectorPlaceDetails from "../prospectorPlaceDetails.js";
import type * as prospectorRanking from "../prospectorRanking.js";
import type * as publicApi from "../publicApi.js";
import type * as publisherAI from "../publisherAI.js";
import type * as referrals from "../referrals.js";
import type * as referralsActions from "../referralsActions.js";
import type * as salesAssets from "../salesAssets.js";
import type * as search from "../search.js";
import type * as security from "../security.js";
import type * as securityActions from "../securityActions.js";
import type * as social from "../social.js";
import type * as socialActions from "../socialActions.js";
import type * as socialActionsHelpers from "../socialActionsHelpers.js";
import type * as tasks from "../tasks.js";
import type * as trends from "../trends.js";
import type * as trendsActions from "../trendsActions.js";
import type * as trendsActionsHelpers from "../trendsActionsHelpers.js";
import type * as webhookDelivery from "../webhookDelivery.js";
import type * as webhookDeliveryHelpers from "../webhookDeliveryHelpers.js";
import type * as whatsapp from "../whatsapp.js";
import type * as whatsappInbound from "../whatsappInbound.js";
import type * as whatsappOut from "../whatsappOut.js";
import type * as whatsappOutHelpers from "../whatsappOutHelpers.js";
import type * as whatsappTemplatesActions from "../whatsappTemplatesActions.js";
import type * as workspaceKnowledge from "../workspaceKnowledge.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  "ai/catalog": typeof ai_catalog;
  "ai/providers": typeof ai_providers;
  "ai/registry": typeof ai_registry;
  "ai/router": typeof ai_router;
  aiHelpers: typeof aiHelpers;
  aiWorkflowHelpers: typeof aiWorkflowHelpers;
  aiWorkflows: typeof aiWorkflows;
  analytics: typeof analytics;
  analyticsActions: typeof analyticsActions;
  analyticsActionsHelpers: typeof analyticsActionsHelpers;
  apiUsage: typeof apiUsage;
  auth: typeof auth;
  automationEngine: typeof automationEngine;
  automationEngineHelpers: typeof automationEngineHelpers;
  broadcasts: typeof broadcasts;
  broadcastsDispatch: typeof broadcastsDispatch;
  calendar: typeof calendar;
  calendarActions: typeof calendarActions;
  calendarActionsHelpers: typeof calendarActionsHelpers;
  campaignRunner: typeof campaignRunner;
  campaignRunnerHelpers: typeof campaignRunnerHelpers;
  campaigns: typeof campaigns;
  cloudflareEmailRoutingActions: typeof cloudflareEmailRoutingActions;
  cloudflareEmailRoutingHelpers: typeof cloudflareEmailRoutingHelpers;
  coldOutreach: typeof coldOutreach;
  coldOutreachQueries: typeof coldOutreachQueries;
  companies: typeof companies;
  composio: typeof composio;
  composioActions: typeof composioActions;
  composioHelpers: typeof composioHelpers;
  contacts: typeof contacts;
  content: typeof content;
  copilot: typeof copilot;
  copilotAgent: typeof copilotAgent;
  copilotAgentKeys: typeof copilotAgentKeys;
  copilotHelpers: typeof copilotHelpers;
  crons: typeof crons;
  dailyBriefings: typeof dailyBriefings;
  dailyBriefingsHelpers: typeof dailyBriefingsHelpers;
  demoRecordings: typeof demoRecordings;
  demoRecordingsHelpers: typeof demoRecordingsHelpers;
  documents: typeof documents;
  documentsActions: typeof documentsActions;
  documentsActionsHelpers: typeof documentsActionsHelpers;
  documentsPdf: typeof documentsPdf;
  emailTemplates: typeof emailTemplates;
  emails: typeof emails;
  emailsInbound: typeof emailsInbound;
  emailsInboundFetch: typeof emailsInboundFetch;
  emailsInboundFetch_helpers: typeof emailsInboundFetch_helpers;
  emailsOut: typeof emailsOut;
  emailsOutHelpers: typeof emailsOutHelpers;
  emailsOutSystem: typeof emailsOutSystem;
  emailsOutSystemHelpers: typeof emailsOutSystemHelpers;
  files: typeof files;
  http: typeof http;
  integrations: typeof integrations;
  integrationsTests: typeof integrationsTests;
  integrationsTestsHelpers: typeof integrationsTestsHelpers;
  "lib/agentPersona": typeof lib_agentPersona;
  "lib/attribution": typeof lib_attribution;
  "lib/authHelpers": typeof lib_authHelpers;
  "lib/emailThread": typeof lib_emailThread;
  "lib/orgMailer": typeof lib_orgMailer;
  "lib/secrets": typeof lib_secrets;
  "lib/secretsAccess": typeof lib_secretsAccess;
  "lib/systemMailer": typeof lib_systemMailer;
  "lib/timeline": typeof lib_timeline;
  "lib/tokenEstimate": typeof lib_tokenEstimate;
  "lib/workspaceContext": typeof lib_workspaceContext;
  "lib/workspaceContextAi": typeof lib_workspaceContextAi;
  mailer: typeof mailer;
  notes: typeof notes;
  notifications: typeof notifications;
  organizations: typeof organizations;
  outreachSuggestions: typeof outreachSuggestions;
  pageAgents: typeof pageAgents;
  pageAgentsHelpers: typeof pageAgentsHelpers;
  payments: typeof payments;
  paymentsActions: typeof paymentsActions;
  paymentsHelpers: typeof paymentsHelpers;
  pipelines: typeof pipelines;
  pipelinesActions: typeof pipelinesActions;
  prospector: typeof prospector;
  prospectorActions: typeof prospectorActions;
  prospectorAutoRank: typeof prospectorAutoRank;
  prospectorEnrich: typeof prospectorEnrich;
  prospectorEnrichHelpers: typeof prospectorEnrichHelpers;
  prospectorHelpers: typeof prospectorHelpers;
  prospectorOsm: typeof prospectorOsm;
  prospectorOsmHelpers: typeof prospectorOsmHelpers;
  prospectorPlaceDetails: typeof prospectorPlaceDetails;
  prospectorRanking: typeof prospectorRanking;
  publicApi: typeof publicApi;
  publisherAI: typeof publisherAI;
  referrals: typeof referrals;
  referralsActions: typeof referralsActions;
  salesAssets: typeof salesAssets;
  search: typeof search;
  security: typeof security;
  securityActions: typeof securityActions;
  social: typeof social;
  socialActions: typeof socialActions;
  socialActionsHelpers: typeof socialActionsHelpers;
  tasks: typeof tasks;
  trends: typeof trends;
  trendsActions: typeof trendsActions;
  trendsActionsHelpers: typeof trendsActionsHelpers;
  webhookDelivery: typeof webhookDelivery;
  webhookDeliveryHelpers: typeof webhookDeliveryHelpers;
  whatsapp: typeof whatsapp;
  whatsappInbound: typeof whatsappInbound;
  whatsappOut: typeof whatsappOut;
  whatsappOutHelpers: typeof whatsappOutHelpers;
  whatsappTemplatesActions: typeof whatsappTemplatesActions;
  workspaceKnowledge: typeof workspaceKnowledge;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
