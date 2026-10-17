import { CAFDrmConfig, CAFMediaInfoCustomData, CAFSourceOptions } from 'bitmovin-player';
import {
  CastReceiverContext,
  ContentProtection,
  NetworkRequestInfo,
  PlaybackConfig,
  PlayerManager,
} from 'chromecast-caf-receiver/cast.framework';
import type { RequestData } from 'chromecast-caf-receiver/cast.framework.messages';
import { LoadRequestData } from 'chromecast-caf-receiver/cast.framework.messages';
import type { Event } from 'chromecast-caf-receiver/cast.framework.system';

const CAST_MESSAGE_NAMESPACE = 'urn:x-cast:com.bitmovin.player.caf';

type RequestHandler = NonNullable<PlaybackConfig['manifestRequestHandler']>;

type SignedQuery = {
  urlPrefix: string;
  query: string;
};

type SignedQueriesCustomData = CAFMediaInfoCustomData & {
  signedQueries?: SignedQuery[];
};

export default class CAFReceiver {
  private readonly player: PlayerManager;
  private readonly context: CastReceiverContext;

  constructor() {
    this.context = cast.framework.CastReceiverContext.getInstance();
    this.player = this.context.getPlayerManager();
  }

  public init() {
    // cast.framework.CastReceiverContext.getInstance().setLoggerLevel(cast.framework.LoggerLevel.DEBUG);

    this.attachEvents();
    this.context.start();
  }

  private attachEvents() {
    this.player.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, this.onLoad);
    this.player.setMessageInterceptor(cast.framework.messages.MessageType.MEDIA_STATUS, this.preprocessMediaStatusUpdate);
    this.context.addCustomMessageListener(CAST_MESSAGE_NAMESPACE, this.onCustomMessage);
  }

  private readonly onLoad = (loadRequestData: LoadRequestData): LoadRequestData => {
    const customData = loadRequestData.media.customData as SignedQueriesCustomData;

    if (customData?.options) {
      this.setWithCredentials(customData.options);
    }

    if (customData?.signedQueries?.length) {
      this.setSignedQueries(customData.signedQueries);
    }

    if (customData?.drm) {
      this.setDRM(customData.drm);
    }

    return loadRequestData;
  };

  /**
   * Preprocesses the outgoing media status messages and add additional custom data.
   */
  private readonly preprocessMediaStatusUpdate = (message: RequestData): RequestData => {
    const startAbsoluteTime = this.player.getStartAbsoluteTime();
    const additionalCustomData = { startAbsoluteTime };

    message.customData = {
      ...message.customData || {},
      ...additionalCustomData,
    };

    return message;
  };

  private setDRM({ protectionSystem, licenseUrl, headers, withCredentials }: CAFDrmConfig): void {
    this.context.getPlayerManager().setMediaPlaybackInfoHandler((_loadRequest, playbackConfig) => {
      playbackConfig.licenseUrl = licenseUrl;
      playbackConfig.protectionSystem = protectionSystem as ContentProtection;

      if (typeof headers === 'object') {
        playbackConfig.licenseRequestHandler = (requestInfo) => {
          requestInfo.headers = headers;
        };
      }

      if (withCredentials) {
        playbackConfig.licenseRequestHandler = setWithCredentialsFlag;
      }

      return playbackConfig;
    });
  }

  private setWithCredentials(options: CAFSourceOptions): void {
    const playerManager = this.context.getPlayerManager();
    const playbackConfig = Object.assign(new cast.framework.PlaybackConfig(), playerManager.getPlaybackConfig());

    if (options.withCredentials) {
      playbackConfig.segmentRequestHandler = setWithCredentialsFlag;
      playbackConfig.captionsRequestHandler = setWithCredentialsFlag;
    }

    if (options.manifestWithCredentials) {
      playbackConfig.manifestRequestHandler = setWithCredentialsFlag;
    }

    playerManager.setPlaybackConfig(playbackConfig);
  }

  private setSignedQueries(signedQueries: SignedQuery[]): void {
    const playerManager = this.context.getPlayerManager();
    const playbackConfig = Object.assign(new cast.framework.PlaybackConfig(), playerManager.getPlaybackConfig());

    const withSignedQuery = (existingHandler?: RequestHandler): RequestHandler => (requestInfo) => {
      const handled = existingHandler?.(requestInfo);
      requestInfo.url = appendSignedQuery(requestInfo.url, signedQueries);
      return handled;
    };

    playbackConfig.manifestRequestHandler = withSignedQuery(playbackConfig.manifestRequestHandler);
    playbackConfig.segmentRequestHandler = withSignedQuery(playbackConfig.segmentRequestHandler);
    playbackConfig.captionsRequestHandler = withSignedQuery(playbackConfig.captionsRequestHandler);

    playerManager.setPlaybackConfig(playbackConfig);
    console.log('Registered signed queries for', signedQueries.map(({ urlPrefix }) => urlPrefix));
  }

  private readonly onCustomMessage = (message: Event) => {
    console.log('Received custom channel message', message);
  };
}

function appendSignedQuery(url: string, signedQueries: SignedQuery[]): string {
  const match = signedQueries.find(({ urlPrefix }) => url.startsWith(urlPrefix));
  if (!match) {
    return url;
  }
  return `${url}${url.includes('?') ? '&' : '?'}${match.query}`;
}

function setWithCredentialsFlag(requestInfo: NetworkRequestInfo): void {
  requestInfo.withCredentials = true;
}
