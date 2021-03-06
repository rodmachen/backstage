/*
 * Copyright 2020 Spotify AB
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { LocationSpec } from '@backstage/catalog-model';
import fetch, { RequestInit, HeadersInit } from 'node-fetch';
import * as result from './results';
import { LocationProcessor, LocationProcessorEmit } from './types';

export class AzureApiReaderProcessor implements LocationProcessor {
  private privateToken: string = process.env.AZURE_PRIVATE_TOKEN || '';

  getRequestOptions(): RequestInit {
    const headers: HeadersInit = {};

    if (this.privateToken !== '') {
      headers.Authorization = `Basic ${Buffer.from(
        `:${this.privateToken}`,
        'utf8',
      ).toString('base64')}`;
    }

    const requestOptions: RequestInit = {
      headers,
    };

    return requestOptions;
  }

  async readLocation(
    location: LocationSpec,
    optional: boolean,
    emit: LocationProcessorEmit,
  ): Promise<boolean> {
    if (location.type !== 'azure/api') {
      return false;
    }

    try {
      const url = this.buildRawUrl(location.target);

      const response = await fetch(url.toString(), this.getRequestOptions());

      if (response.ok) {
        const data = await response.buffer();
        emit(result.data(location, data));
      } else {
        const message = `${location.target} could not be read as ${url}, ${response.status} ${response.statusText}`;
        if (response.status === 404) {
          if (!optional) {
            emit(result.notFoundError(location, message));
          }
        } else {
          emit(result.generalError(location, message));
        }
      }
    } catch (e) {
      const message = `Unable to read ${location.type} ${location.target}, ${e}`;
      emit(result.generalError(location, message));
    }
    return true;
  }

  // Converts
  // from: https://dev.azure.com/{organization}/{project}/_git/reponame?path={path}&version=GB{commitOrBranch}&_a=contents
  // to:   https://dev.azure.com/{organization}/{project}/_apis/sourceProviders/{providerName}/filecontents?repository={repository}&commitOrBranch={commitOrBranch}&path={path}&api-version=6.0-preview.1

  buildRawUrl(target: string): URL {
    try {
      const url = new URL(target);

      const [
        empty,
        userOrOrg,
        project,
        srcKeyword,
        repoName,
      ] = url.pathname.split('/');

      const path = url.searchParams.get('path') || '';
      const ref = url.searchParams.get('version')?.substr(2);

      if (
        url.hostname !== 'dev.azure.com' ||
        empty !== '' ||
        userOrOrg === '' ||
        project === '' ||
        srcKeyword !== '_git' ||
        repoName === '' ||
        path === '' ||
        ref === '' ||
        !path.match(/\.yaml$/)
      ) {
        throw new Error('Wrong Azure Devops URL or Invalid file path');
      }

      // transform to api
      url.pathname = [
        empty,
        userOrOrg,
        project,
        '_apis',
        'sourceProviders',
        'TfsGit',
        'filecontents',
      ].join('/');

      url.search = [
        `repository=${repoName}`,
        `commitOrBranch=${ref}`,
        `path=${path}`,
        'api-version=6.0-preview.1',
      ].join('&');

      url.protocol = 'https';

      return url;
    } catch (e) {
      throw new Error(`Incorrect url: ${target}, ${e}`);
    }
  }
}
