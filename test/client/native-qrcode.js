/* @flow */
/* eslint require-await: off, max-lines: off, max-nested-callbacks: off */

import { wrapPromise, uniqueID, parseQuery } from 'belter/src';
import { ZalgoPromise } from 'zalgo-promise/src';
import { FUNDING, PLATFORM } from '@paypal/sdk-constants/src';

import { promiseNoop } from '../../src/lib';

import { mockSetupButton, mockAsyncProp, createButtonHTML, clickButton,
    getNativeFirebaseMock, getGraphQLApiMock, mockFunction, generateOrderID, DEFAULT_FUNDING_ELIGIBILITY } from './mocks';

const fundingEligibility = {
    [ FUNDING.VENMO ]: {
        eligible: true
    }
};

describe('native qrcode cases', () => {

    it.skip('should render a button with createOrder, click the button, and render checkout via qrcode path', async () => {
        return await wrapPromise(async ({ expect, avoid }) => {
            window.xprops.platform = PLATFORM.MOBILE;
            delete window.xprops.onClick;

            const sessionToken = uniqueID();
            const orderID = uniqueID();
            const payerID = 'AAABBBCCC';

            const gqlMock = getGraphQLApiMock({
                extraHandler: expect('firebaseGQLCall', ({ data }) => {
                    if (!data.query.includes('query GetFireBaseSessionToken')) {
                        return;
                    }

                    if (!data.variables.sessionUID) {
                        throw new Error(`Expected sessionUID to be passed`);
                    }

                    return {
                        data: {
                            firebase: {
                                auth: {
                                    sessionUID: data.variables.sessionUID,
                                    sessionToken
                                }
                            }
                        }
                    };
                })
            }).expectCalls();

            let mockWebSocketServer;

            mockFunction(window.paypal, 'QRCode', expect('QRCode', ({ original, args: [ props ] }) => {
                const query = parseQuery(props.qrPath.split('?')[1]);

                const { expect: expectSocket, onInit, onApprove } = getNativeFirebaseMock({
                    sessionUID:   query.sessionUID
                });

                mockWebSocketServer = expectSocket();
                
                ZalgoPromise.try(() => {
                    return onInit();
                }).then(() => {
                    return onApprove({ payerID });
                });

                return original(props);
            }));

            window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                return ZalgoPromise.try(() => {
                    return orderID;
                });
            }), 50);

            window.xprops.onCancel = avoid('onCancel');

            window.xprops.onApprove = mockAsyncProp(expect('onApprove', (data) => {
                if (data.orderID !== orderID) {
                    throw new Error(`Expected orderID to be ${ orderID }, got ${ data.orderID }`);
                }

                if (data.payerID !== payerID) {
                    throw new Error(`Expected payerID to be ${ payerID }, got ${ data.payerID }`);
                }
            }));

            await mockSetupButton({
                fundingEligibility,
                eligibility: {
                    cardFields: false,
                    native:     true
                },
                cookies: 'login_email=s@paypal.com'
            });

            await clickButton(FUNDING.VENMO);
            await window.xprops.onApprove.await();

            if (mockWebSocketServer) {
                mockWebSocketServer.done();
            }
            
            gqlMock.done();
        });
    });

    it('should render a button with createOrder, click the button, and render checkout via qrcode path with onClick rejecting', async () => {
        return await wrapPromise(async ({ expect, avoid }) => {
            window.xprops.platform = PLATFORM.MOBILE;
            delete window.xprops.onClick;

            const QRCode = window.paypal.QRCode;
            mockFunction(window.paypal, 'QRCode', avoid('QRCode', QRCode));

            window.xprops.createOrder = mockAsyncProp(avoid('createOrder', uniqueID));

            window.xprops.onClick = mockAsyncProp(expect('onClick', async (data, actions) => {
                return actions.reject();
            }), 50);

            window.xprops.onCancel = mockAsyncProp(avoid('onCancel', promiseNoop));
            window.xprops.onApprove = mockAsyncProp(avoid('onApprove', promiseNoop));

            createButtonHTML({ fundingEligibility });

            await mockSetupButton({
                fundingEligibility,
                eligibility: {
                    cardFields: false,
                    native:     true
                }
            });

            await clickButton(FUNDING.VENMO);
        });
    });

    it('should render a button with createOrder, click the button, and render checkout via qrcode path with eligibility failing', async () => {
        return await wrapPromise(async ({ expect, avoid }) => {
            window.xprops.platform = PLATFORM.MOBILE;
            delete window.xprops.onClick;

            const QRCode = window.paypal.QRCode;
            mockFunction(window.paypal, 'QRCode', avoid('QRCode', QRCode));

            const gqlMock = getGraphQLApiMock({
                extraHandler: expect('firebaseGQLCall', ({ data }) => {
                    if (data.query.includes('query GetNativeEligibility')) {
                        return {
                            data: {
                                mobileSDKEligibility: {
                                    paypal: {
                                        eligibility: true
                                    },
                                    venmo: {
                                        eligibility:         false,
                                        ineligibilityReason: 'isEnvEligible'
                                    }
                                }
                            }
                        };
                    }
                })
            }).expectCalls();

            const orderID = generateOrderID();
            const payerID = 'AAABBBCCC';

            window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                return ZalgoPromise.try(() => {
                    return orderID;
                });
            }), 50);

            window.xprops.onCancel = avoid('onCancel');

            window.xprops.onApprove = mockAsyncProp(expect('onApprove', (data) => {
                if (data.orderID !== orderID) {
                    throw new Error(`Expected orderID to be ${ orderID }, got ${ data.orderID }`);
                }

                if (data.payerID !== payerID) {
                    throw new Error(`Expected payerID to be ${ payerID }, got ${ data.payerID }`);
                }
            }));

            createButtonHTML({ fundingEligibility });

            await mockSetupButton({
                fundingEligibility,
                eligibility: {
                    cardFields: false,
                    native:     true
                }
            });

            await clickButton(FUNDING.VENMO);
            await window.xprops.onApprove.await();

            gqlMock.done();
        });
    });

    describe('for DESKTOP', () => {
        it('should render a button with createOrder, click the button, and render checkout via qrcode path with eligibility failing', async () => {
            return await wrapPromise(async ({ expect, avoid }) => {
                window.xprops.platform = PLATFORM.DESKTOP;
                delete window.xprops.onClick;
    
                const QRCode = window.paypal.QRCode;
                mockFunction(window.paypal, 'QRCode', avoid('QRCode', QRCode));
    
                const gqlMock = getGraphQLApiMock({
                    extraHandler: expect('firebaseGQLCall', ({ data }) => {
                        if (data.query.includes('query GetNativeEligibility')) {
                            return {
                                data: {
                                    mobileSDKEligibility: {
                                        paypal: {
                                            eligibility: true
                                        },
                                        venmo: {
                                            eligibility:         false,
                                            ineligibilityReason: 'isEnvEligible'
                                        }
                                    }
                                }
                            };
                        }
                    })
                }).expectCalls();
    
                const orderID = generateOrderID();
                const payerID = 'AAABBBCCC';
    
                window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                    return ZalgoPromise.try(() => {
                        return orderID;
                    });
                }), 50);
    
                window.xprops.onCancel = avoid('onCancel');
    
                window.xprops.onApprove = mockAsyncProp(expect('onApprove', (data) => {
                    if (data.orderID !== orderID) {
                        throw new Error(`Expected orderID to be ${ orderID }, got ${ data.orderID }`);
                    }
    
                    if (data.payerID !== payerID) {
                        throw new Error(`Expected payerID to be ${ payerID }, got ${ data.payerID }`);
                    }
                }));
        
                createButtonHTML({ fundingEligibility });
    
                await mockSetupButton({
                    fundingEligibility,
                    eligibility: {
                        cardFields: false,
                        native:     true
                    }
                });
    
                await clickButton(FUNDING.VENMO);
                await window.xprops.onApprove.await();
    
                gqlMock.done();
            });
        });
    
        it('should render a button with createOrder, click the button, and render checkout via qrcode path with empty ineligibilityReason', async () => {
            return await wrapPromise(async ({ expect, avoid }) => {
                window.xprops.platform = PLATFORM.DESKTOP;
                window.xprops.intent = 'capture';
                delete window.xprops.onClick;
    
                const sessionToken = uniqueID();
                const payerID = 'AAABBBCCC';
    
                const gqlMock = getGraphQLApiMock({
                    extraHandler: expect('firebaseGQLCall', ({ data }) => {
                        if (data.query.includes('query GetNativeEligibility')) {
                            return {
                                data: {
                                    mobileSDKEligibility: {
                                        paypal: {
                                            eligibility: true
                                        },
                                        venmo: {
                                            eligibility:         true,
                                            ineligibilityReason: ''
                                        }
                                    }
                                }
                            };
                        }
    
                        if (!data.query.includes('query GetFireBaseSessionToken')) {
                            return;
                        }
    
                        if (!data.variables.sessionUID) {
                            throw new Error(`Expected sessionUID to be passed`);
                        }
    
                        return {
                            data: {
                                firebase: {
                                    auth: {
                                        sessionUID: data.variables.sessionUID,
                                        sessionToken
                                    }
                                }
                            }
                        };
                    })
                }).expectCalls();
    
                let mockWebSocketServer;
    
                mockFunction(window.paypal, 'QRCode', expect('QRCode', ({ original, args: [ props ] }) => {
                    const query = parseQuery(props.qrPath.split('?')[1]);
    
                    const { expect: expectSocket, onInit, onApprove } = getNativeFirebaseMock({
                        sessionUID:   query.sessionUID
                    });
    
                    mockWebSocketServer = expectSocket();
                    
                    ZalgoPromise.try(() => {
                        return onInit();
                    }).then(() => {
                        return onApprove({ payerID });
                    });
    
                    return original(props);
                }));
    
                const orderID = generateOrderID();
    
                window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                    return ZalgoPromise.try(() => {
                        return orderID;
                    });
                }), 50);
    
                window.xprops.onCancel = avoid('onCancel');
    
                window.xprops.onApprove = mockAsyncProp(expect('onApprove', (data) => {
                    if (data.orderID !== orderID) {
                        throw new Error(`Expected orderID to be ${ orderID }, got ${ data.orderID }`);
                    }
    
                    if (data.payerID !== payerID) {
                        throw new Error(`Expected payerID to be ${ payerID }, got ${ data.payerID }`);
                    }
                }));
        
                createButtonHTML({ fundingEligibility });
    
                await mockSetupButton({
                    fundingEligibility,
                    eligibility: {
                        cardFields: false,
                        native:     true
                    },
                    cookies: 'login_email=s@paypal.com'
                });
    
                await clickButton(FUNDING.VENMO);
                await window.xprops.onApprove.await();
    
                if (mockWebSocketServer) {
                    mockWebSocketServer.done();
                }
                
                gqlMock.done();
            });
        });

        it('should render a button with createOrder, click the button, and render checkout via qrcode that contains escape path with empty ineligibilityReason and escapePath', async () => {
            return await wrapPromise(async ({ expect, avoid }) => {
                window.xprops.platform = PLATFORM.DESKTOP;
                delete window.xprops.onClick;
    
                const sessionToken = uniqueID();
    
                const gqlMock = getGraphQLApiMock({
                    extraHandler: expect('firebaseGQLCall', ({ data }) => {
                        if (data.query.includes('query GetNativeEligibility')) {
                            return {
                                data: {
                                    mobileSDKEligibility: {
                                        paypal: {
                                            eligibility: true
                                        },
                                        venmo: {
                                            eligibility:         true,
                                            ineligibilityReason: ''
                                        }
                                    }
                                }
                            };
                        }
    
                        if (!data.query.includes('query GetFireBaseSessionToken')) {
                            return;
                        }
    
                        if (!data.variables.sessionUID) {
                            throw new Error(`Expected sessionUID to be passed`);
                        }
    
                        return {
                            data: {
                                firebase: {
                                    auth: {
                                        sessionUID: data.variables.sessionUID,
                                        sessionToken
                                    }
                                }
                            }
                        };
                    })
                }).expectCalls();
    
                let mockWebSocketServer;
    
                mockFunction(window.paypal, 'QRCode', expect('QRCode', ({ original, args: [ props ] }) => {
                    const query = parseQuery(props.qrPath.split('?')[1]);
    
                    const { expect: expectSocket, onInit } = getNativeFirebaseMock({
                        sessionUID:   query.sessionUID
                    });
    
                    mockWebSocketServer = expectSocket();
                    
                    ZalgoPromise.try(() => {
                        return onInit();
                    }).then(() => {
                        return props.onEscapePath(FUNDING.PAYPAL);
                    });
    
                    return original(props);
                }));
    
                const orderID = generateOrderID();
    
                window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                    return ZalgoPromise.try(() => {
                        return orderID;
                    });
                }), 50);
    
                window.xprops.onCancel = avoid('onCancel');
                window.xprops.onApprove = avoid('onApprove');
    
                createButtonHTML({ fundingEligibility });
    
                await mockSetupButton({
                    fundingEligibility,
                    eligibility: {
                        cardFields: false,
                        native:     true
                    },
                    cookies: 's@paypal.com'
                });
    
                await clickButton(FUNDING.VENMO);

                if (mockWebSocketServer) {
                    mockWebSocketServer.done();
                }
                
                gqlMock.done();
            });
        });

        it('should render a button with createOrder, click the button, and render checkout but not call GraphQL for non-Venmo', async () => {
            return await wrapPromise(async ({ expect, avoid }) => {
                window.xprops.platform = PLATFORM.DESKTOP;
                delete window.xprops.onClick;
    
                const QRCode = window.paypal.QRCode;
                mockFunction(window.paypal, 'QRCode', avoid('QRCode', QRCode));
    
                const gqlMock = getGraphQLApiMock({
                    extraHandler: avoid('firebaseGQLCall')
                });
    
                const orderID = generateOrderID();
                const payerID = 'AAABBBCCC';
    
                window.xprops.createOrder = mockAsyncProp(expect('createOrder', async () => {
                    return ZalgoPromise.try(() => {
                        return orderID;
                    });
                }), 50);
    
                window.xprops.onCancel = avoid('onCancel');
    
                window.xprops.onApprove = mockAsyncProp(expect('onApprove', (data) => {
                    if (data.orderID !== orderID) {
                        throw new Error(`Expected orderID to be ${ orderID }, got ${ data.orderID }`);
                    }
    
                    if (data.payerID !== payerID) {
                        throw new Error(`Expected payerID to be ${ payerID }, got ${ data.payerID }`);
                    }
                }));
        
                createButtonHTML({ fundingEligibility: DEFAULT_FUNDING_ELIGIBILITY });
    
                const eligibility = {
                    cardFields: false,
                    native:     true
                };

                // Use default fundingEligibility which is PayPal only
                await mockSetupButton({
                    fundingEligibility: DEFAULT_FUNDING_ELIGIBILITY,
                    eligibility
                });

                await clickButton(FUNDING.PAYPAL);
                await window.xprops.onApprove.await();
    
                gqlMock.done();
            });
        });
    });
});
