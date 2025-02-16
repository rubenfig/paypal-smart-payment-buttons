/* @flow */

import { ENV, DEFAULT_COUNTRY, COUNTRY_LANGS } from '@paypal/sdk-constants';

import type { ExpressRequest, ExpressResponse, LocaleType } from '../../types';
import { getCSPNonce } from '../../lib';

type ParamsType = {|
    env : $Values<typeof ENV>,
    qrPath : string,
    demo? : boolean,
    locale? : LocaleType,
    debug? : boolean,
    buttonSessionID : string
|};

type RequestParams = {|
    env : $Values<typeof ENV>,
    cspNonce : string,
    qrPath : string,
    demo : boolean,
    locale : LocaleType,
    debug : boolean,
    buttonSessionID : string
|};

export function getParams(params : ParamsType, req : ExpressRequest, res : ExpressResponse) : RequestParams {
    const {
        env,
        qrPath,
        demo,
        locale = {},
        debug = false,
        buttonSessionID
    } = params;

    const {
        country = DEFAULT_COUNTRY,
        lang = COUNTRY_LANGS[country][0]
    } = locale;

    const cspNonce = getCSPNonce(res);

    return {
        env,
        cspNonce,
        qrPath,
        demo:   Boolean(demo),
        debug:  Boolean(debug),
        locale: { country, lang },
        buttonSessionID
    };
}
