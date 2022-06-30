/* @flow */

import { html } from '@krakenjs/jsx-pragmatic';
import { COUNTRY, LANG, FPTI_KEY, FPTI_FEED } from '@paypal/sdk-constants';
import { stringifyError, noop } from '@krakenjs/belter';

import { clientErrorResponse, htmlResponse, allowFrame, defaultLogger, safeJSON, sdkMiddleware, type ExpressMiddleware,
    graphQLBatch, type GraphQL, javascriptResponse, emptyResponse, promiseTimeout, isLocalOrTest, getDefaultExperiments, type GetExperimentsParams, type GetExperimentsType } from '../../lib';
import { resolveFundingEligibility, resolveMerchantID, resolveWallet, resolvePersonalization } from '../../service';
import { EXPERIMENT_TIMEOUT, TIMEOUT_ERROR_MESSAGE, FPTI_STATE } from '../../config';
import type { LoggerType, CacheType, ExpressRequest, FirebaseConfig, InstanceLocationInformation, SDKLocationInformation, SDKVersionManager } from '../../types';
import type { ContentType } from '../../../src/types';

import { getSmartPaymentButtonsClientScript, getPayPalSmartPaymentButtonsRenderScript } from './script';
import { getButtonParams, getButtonPreflightParams } from './params';
import { buttonStyle } from './style';
import { getRootTransactionName, setRootTransaction } from './instrumentation';

type ButtonMiddlewareOptions = {|
    logger : LoggerType,
    graphQL : GraphQL,
    getAccessToken : (ExpressRequest, string) => Promise<string>,
    getMerchantID : (ExpressRequest, string) => Promise<string>,
    cache : CacheType,
    firebaseConfig? : FirebaseConfig,
    content : {
        [$Values<typeof COUNTRY>] : {
            [$Values<typeof LANG>] : ContentType
        }
    },
    tracking : (ExpressRequest) => void,
    getPersonalizationEnabled : (ExpressRequest) => boolean,
    cdn? : boolean,
    getInstanceLocationInformation : () => InstanceLocationInformation,
    getSDKLocationInformation : (req : ExpressRequest, env : string) => Promise<SDKLocationInformation>,
    getExperiments? : (req : ExpressRequest, params : GetExperimentsParams) => Promise<GetExperimentsType>,
    sdkVersionManager: SDKVersionManager
|};

export function getButtonMiddleware({
    logger = defaultLogger,
    content: smartContent,
    graphQL,
    getAccessToken,
    cdn = !isLocalOrTest(),
    getMerchantID,
    cache,
    firebaseConfig,
    tracking,
    getPersonalizationEnabled = () => false,
    getInstanceLocationInformation,
    getSDKLocationInformation,
    getExperiments = getDefaultExperiments,
    sdkVersionManager,
} : ButtonMiddlewareOptions = {}) : ExpressMiddleware {
    const useLocal = !cdn;

    const locationInformation = getInstanceLocationInformation();

    return sdkMiddleware({ logger, cache, locationInformation }, {
        app: async ({ req, res, params, meta, logBuffer, sdkMeta }) => {
            logger.info(req, 'smart_buttons_render');
            const middlewareStartTime = Date.now();

            for (const name of Object.keys(req.cookies || {})) {
                logger.info(req, `smart_buttons_cookie_${ name || 'unknown' }`);
            }

            tracking(req);

            const { env, clientID, buttonSessionID, cspNonce, debug, buyerCountry, disableFunding, disableCard, userIDToken, amount, renderedButtons,
                merchantID: sdkMerchantID, currency, intent, commit, vault, clientAccessToken, basicFundingEligibility, locale,
                correlationID, cookies, enableFunding, style, paymentMethodToken, branded, fundingSource, allowBillingPayments, buttonSize } = getButtonParams(params, req, res);

            const { label, period, tagline, layout } = style;
            logger.info(req, `button_params`, { params: JSON.stringify(params) });

            const sdkLocationInformation = await getSDKLocationInformation(req, params.env);

            if (!clientID) {
                return clientErrorResponse(res, 'Please provide a clientID query parameter');
            }

            const gqlBatch = graphQLBatch(req, graphQL, { env });
            const content = smartContent[locale.country][locale.lang] || {};

            const facilitatorAccessTokenPromise = getAccessToken(req, clientID);
            const merchantIDPromise = facilitatorAccessTokenPromise.then(facilitatorAccessToken => resolveMerchantID(req, { merchantID: sdkMerchantID, getMerchantID, facilitatorAccessToken }));
            const clientPromise = getSmartPaymentButtonsClientScript({ debug, logBuffer, cache, useLocal, locationInformation });
            const renderPromise = getPayPalSmartPaymentButtonsRenderScript({
                sdkCDNRegistry: sdkLocationInformation?.sdkCDNRegistry,
                cache,
                logBuffer,
                useLocal,
                sdkVersionManager
            });
            const sdkVersion = sdkVersionManager.getLiveVersion();

            const fundingEligibilityPromise = resolveFundingEligibility(req, gqlBatch, {
                logger, clientID, merchantID: sdkMerchantID, buttonSessionID, currency, intent, commit, vault,
                disableFunding, disableCard, clientAccessToken, buyerCountry, basicFundingEligibility, enableFunding
            });
            const fundingEligibility = await fundingEligibilityPromise;

            const walletPromise = resolveWallet(req, gqlBatch, {
                logger, clientID, merchantID: sdkMerchantID, buttonSessionID, currency, intent, commit, vault, amount,
                disableFunding, disableCard, clientAccessToken, buyerCountry, userIDToken, paymentMethodToken, branded, allowBillingPayments
            }).catch(noop);

            const personalizationEnabled = getPersonalizationEnabled(req);
            const personalizationPromise = resolvePersonalization(req, gqlBatch, {
                logger, clientID, buyerCountry, locale, buttonSessionID, currency, intent, commit,
                vault, label, period, tagline, personalizationEnabled, renderedButtons, layout, buttonSize, fundingEligibility
            });

            gqlBatch.flush();

            let facilitatorAccessToken;

            try {
                facilitatorAccessToken = await facilitatorAccessTokenPromise;
            } catch (err) {
                if (err && err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
                    return clientErrorResponse(res, 'Invalid clientID');
                }

                throw err;
            }

            const renderButton = await renderPromise;
            const client = await clientPromise;
            const merchantID = await merchantIDPromise;
            const wallet = await walletPromise;
            const personalization = await personalizationPromise;

            const getExperimentsPromise = promiseTimeout(getExperiments(req, { buttonSessionID, clientID, fundingSource, wallet, merchantID: merchantID[0], locale, buyerCountry  }), EXPERIMENT_TIMEOUT)
                .catch((err) => {
                    if (err.message && err.message.includes(TIMEOUT_ERROR_MESSAGE)) {
                        logger.track(req, {
                            [FPTI_KEY.STATE]:           FPTI_STATE.BUTTON,
                            [FPTI_KEY.TRANSITION]:      'get_experiments_promise_timeout',
                            [FPTI_KEY.CONTEXT_ID]:      buttonSessionID,
                            [FPTI_KEY.CONTEXT_TYPE]:    'button_session_id',
                            [FPTI_KEY.FEED]:            'payments_sdk'
                        }, {});
                    }
                    return getDefaultExperiments();
                });
            const experiments = await getExperimentsPromise;
            const eligibility = {
                cardFields: experiments.isCardFieldsExperimentEnabled
            };

            logger.info(req, `button_render_version_${ sdkVersion }`);
            logger.info(req, `button_client_version_${ client.version }`);

            const buttonProps = {
                ...params,
                nonce: cspNonce,
                csp:   {
                    nonce: cspNonce
                },
                fundingEligibility,
                content,
                wallet,
                personalization,
                experiment: {
                    ...params.experiment,
                    ...experiments
                }
            };

            try {
                if (renderButton.validateButtonProps) {
                    renderButton.validateButtonProps(buttonProps);
                }

            } catch (err) {
                return clientErrorResponse(res, err.stack || err.message);
            }
            const buttonHTML = renderButton.Buttons(buttonProps).render(html());
            const setupParams = {
                fundingEligibility, buyerCountry, cspNonce, merchantID, sdkMeta, wallet, correlationID,
                firebaseConfig, facilitatorAccessToken, eligibility, content, cookies, personalization,
                brandedDefault: experiments.isFundingSourceBranded
            };

            const cplCompPayload = {
                'second-render-middleware': {
                    start: middlewareStartTime,
                    tt:    Date.now() - middlewareStartTime
                }
            };

            logger.info(req, 'CPL_LATENCY_METRICS_SECOND_RENDER_MIDDLEWARE');
            logger.track(req, {
                [FPTI_KEY.STATE]:                 'CPL_LATENCY_METRICS',
                [FPTI_KEY.TRANSITION]:            'process_server_metrics',
                [FPTI_KEY.PAGE]:                  'main:xo:paypal-components:smart-payment-buttons',
                [FPTI_KEY.CONTEXT_ID]:            buttonSessionID,
                [FPTI_KEY.FEED]:                  FPTI_FEED.PAYMENTS_SDK,
                [FPTI_KEY.CPL_COMP_METRICS]:      JSON.stringify(cplCompPayload)
            }, {});
            const responseStartTime = Date.now();

            const pageHTML = `
                <!DOCTYPE html>
                <head>
                    <script nonce="${ cspNonce }">
                      if (window.performance && performance.mark) {
                          performance.mark('buttons-response-received');
                      }
                    </script>
                </head>
                <body data-nonce="${ cspNonce }" data-client-version="${ client.version }" data-render-version="${ sdkVersion }" data-response-start-time="${ responseStartTime }">
                    <style nonce="${ cspNonce }">${ buttonStyle }</style>

                    <div id="buttons-container" class="buttons-container" role="main" aria-label="PayPal">${ buttonHTML }</div>

                    ${ meta.getSDKLoader({ nonce: cspNonce }) }
                    <script nonce="${ cspNonce }">${ client.script }</script>
                    <script nonce="${ cspNonce }">spb.setupButton(${ safeJSON(setupParams) })</script>
                </body>
            `;
            const rootTransactionName = getRootTransactionName(userIDToken, clientAccessToken);

            setRootTransaction(req, {
                rootTxnData: {
                    name:                  rootTransactionName,
                    client_id:             clientID,
                    sdk_version:           sdkVersion,
                    smart_buttons_version: client.version
                }
            });
            allowFrame(res);
            return htmlResponse(res, pageHTML);
        },

        script: async ({ req, res, params, logBuffer }) => {
            logger.info(req, 'smart_buttons_script_render');

            const { debug } = getButtonParams(params, req, res);
            const { script } = await getSmartPaymentButtonsClientScript({ debug, logBuffer, cache, useLocal, locationInformation });

            return javascriptResponse(res, script);
        },

        preflight: ({ req, res, params, logBuffer }) => {
            const { clientID, merchantID, currency, userIDToken, amount } = getButtonPreflightParams(params);

            const gqlBatch = graphQLBatch(req, graphQL);

            resolveWallet(req, gqlBatch, {
                logger, clientID, merchantID, currency, amount, userIDToken
            }).catch(err => {
                logBuffer.warn('preflight_error', { err: stringifyError(err) });
            });

            gqlBatch.flush();

            return emptyResponse(res);
        }
    });
}
