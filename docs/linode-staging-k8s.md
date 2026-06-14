# Linode Staging K8s Runtime

Linode staging runtime is K8s-only. The previous Cloud Admin dedicated Linode VM
toolkit has been retired and must not be used for staging provision, deploy,
verify, backup, or VM log collection.

Operate staging from the workspace root:

```sh
./stg.sh provision --confirm video-cloud-staging
scripts/run-staging-e2e.sh --confirm video-cloud-staging
```

Cloud Admin staging traffic should be reached through the K8s ingress/service
path managed by the workspace staging flow.
