{{/*
Helpers shared by every component (backend, frontend, postgres).

They take a dict instead of the plain dot, so one helper can serve all components:
  {{ include "taskflow.fullname" (dict "root" . "component" "backend") }}
    root      = the top-level dot (.Release, .Chart, .Values)
    component = which part of the app this resource belongs to
*/}}

{{/*
Resource name: <release>-<component>
  helm install taskflow → taskflow-backend, taskflow-frontend, taskflow-postgres
  helm install dev      → dev-backend, dev-frontend, dev-postgres
*/}}
{{- define "taskflow.fullname" -}}
{{- printf "%s-%s" .root.Release.Name .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Selector labels: small and STABLE. spec.selector is immutable; changing these
after the first install means deleting the Deployment/StatefulSet.
NetworkPolicies use the same labels to pick pods.
*/}}
{{- define "taskflow.selectorLabels" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/*
All labels: selector labels + information that may change between releases.
*/}}
{{- define "taskflow.labels" -}}
{{ include "taskflow.selectorLabels" . }}
app.kubernetes.io/part-of: taskflow
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .root.Chart.Name .root.Chart.Version | replace "+" "_" }}
{{- end -}}

{{/*
Container image: <repository>:<tag>, tag falls back to Chart.appVersion.
Call with: (dict "root" . "image" .Values.backend.image)
*/}}
{{- define "taskflow.image" -}}
{{- printf "%s:%s" .image.repository (.image.tag | default .root.Chart.AppVersion | toString) -}}
{{- end -}}
