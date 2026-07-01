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
import type * as ai_providers from "../ai/providers.js";
import type * as ai_registry from "../ai/registry.js";
import type * as aiHelpers from "../aiHelpers.js";
import type * as aiWorkflowHelpers from "../aiWorkflowHelpers.js";
import type * as aiWorkflows from "../aiWorkflows.js";
import type * as analytics from "../analytics.js";
import type * as analyticsActions from "../analyticsActions.js";
import type * as analyticsActionsHelpers from "../analyticsActionsHelpers.js";
import type * as auth from "../auth.js";
import type * as broadcasts from "../broadcasts.js";
import type * as broadcastsDispatch from "../broadcastsDispatch.js";
import type * as calendar from "../calendar.js";
import type * as calendarActions from "../calendarActions.js";
import type * as calendarActionsHelpers from "../calendarActionsHelpers.js";
import type * as campaignRunner from "../campaignRunner.js";
import type * as campaignRunnerHelpers from "../campaignRunnerHelpers.js";
import type * as campaigns from "../campaigns.js";
import type * as companies from "../companies.js";
import type * as contacts from "../contacts.js";
import type * as content from "../content.js";
import type * as copilot from "../copilot.js";
import type * as copilotHelpers from "../copilotHelpers.js";
import type * as crons from "../crons.js";
import type * as documents from "../documents.js";
import type * as documentsActions from "../documentsActions.js";
import type * as documentsActionsHelpers from "../documentsActionsHelpers.js";
import type * as emails from "../emails.js";
import type * as emailsInbound from "../emailsInbound.js";
import type * as emailsOut from "../emailsOut.js";
import type * as emailsOutHelpers from "../emailsOutHelpers.js";
import type * as emailsOutSystem from "../emailsOutSystem.js";
import type * as emailsOutSystemHelpers from "../emailsOutSystemHelpers.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as integrations from "../integrations.js";
import type * as integrationsTests from "../integrationsTests.js";
import type * as integrationsTestsHelpers from "../integrationsTestsHelpers.js";
import type * as lib_attribution from "../lib/attribution.js";
import type * as lib_authHelpers from "../lib/authHelpers.js";
import type * as lib_emailThread from "../lib/emailThread.js";
import type * as lib_orgMailer from "../lib/orgMailer.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_secretsAccess from "../lib/secretsAccess.js";
import type * as lib_systemMailer from "../lib/systemMailer.js";
import type * as lib_timeline from "../lib/timeline.js";
import type * as lib_workspaceContext from "../lib/workspaceContext.js";
import type * as mailer from "../mailer.js";
import type * as notes from "../notes.js";
import type * as organizations from "../organizations.js";
import type * as payments from "../payments.js";
import type * as paymentsActions from "../paymentsActions.js";
import type * as paymentsHelpers from "../paymentsHelpers.js";
import type * as pipelines from "../pipelines.js";
import type * as pipelinesActions from "../pipelinesActions.js";
import type * as prospector from "../prospector.js";
import type * as prospectorActions from "../prospectorActions.js";
import type * as prospectorHelpers from "../prospectorHelpers.js";
import type * as referrals from "../referrals.js";
import type * as referralsActions from "../referralsActions.js";
import type * as salesAssets from "../salesAssets.js";
import type * as search from "../search.js";
import type * as social from "../social.js";
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

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  "ai/providers": typeof ai_providers;
  "ai/registry": typeof ai_registry;
  aiHelpers: typeof aiHelpers;
  aiWorkflowHelpers: typeof aiWorkflowHelpers;
  aiWorkflows: typeof aiWorkflows;
  analytics: typeof analytics;
  analyticsActions: typeof analyticsActions;
  analyticsActionsHelpers: typeof analyticsActionsHelpers;
  auth: typeof auth;
  broadcasts: typeof broadcasts;
  broadcastsDispatch: typeof broadcastsDispatch;
  calendar: typeof calendar;
  calendarActions: typeof calendarActions;
  calendarActionsHelpers: typeof calendarActionsHelpers;
  campaignRunner: typeof campaignRunner;
  campaignRunnerHelpers: typeof campaignRunnerHelpers;
  campaigns: typeof campaigns;
  companies: typeof companies;
  contacts: typeof contacts;
  content: typeof content;
  copilot: typeof copilot;
  copilotHelpers: typeof copilotHelpers;
  crons: typeof crons;
  documents: typeof documents;
  documentsActions: typeof documentsActions;
  documentsActionsHelpers: typeof documentsActionsHelpers;
  emails: typeof emails;
  emailsInbound: typeof emailsInbound;
  emailsOut: typeof emailsOut;
  emailsOutHelpers: typeof emailsOutHelpers;
  emailsOutSystem: typeof emailsOutSystem;
  emailsOutSystemHelpers: typeof emailsOutSystemHelpers;
  files: typeof files;
  http: typeof http;
  integrations: typeof integrations;
  integrationsTests: typeof integrationsTests;
  integrationsTestsHelpers: typeof integrationsTestsHelpers;
  "lib/attribution": typeof lib_attribution;
  "lib/authHelpers": typeof lib_authHelpers;
  "lib/emailThread": typeof lib_emailThread;
  "lib/orgMailer": typeof lib_orgMailer;
  "lib/secrets": typeof lib_secrets;
  "lib/secretsAccess": typeof lib_secretsAccess;
  "lib/systemMailer": typeof lib_systemMailer;
  "lib/timeline": typeof lib_timeline;
  "lib/workspaceContext": typeof lib_workspaceContext;
  mailer: typeof mailer;
  notes: typeof notes;
  organizations: typeof organizations;
  payments: typeof payments;
  paymentsActions: typeof paymentsActions;
  paymentsHelpers: typeof paymentsHelpers;
  pipelines: typeof pipelines;
  pipelinesActions: typeof pipelinesActions;
  prospector: typeof prospector;
  prospectorActions: typeof prospectorActions;
  prospectorHelpers: typeof prospectorHelpers;
  referrals: typeof referrals;
  referralsActions: typeof referralsActions;
  salesAssets: typeof salesAssets;
  search: typeof search;
  social: typeof social;
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
