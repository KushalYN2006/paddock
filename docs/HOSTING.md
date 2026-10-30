# EC2 deployment (two instances)

This project includes a two-instance Amazon Linux 2023 deployment for the separate frontend and Fastify backend apps. It does not use the practice repository. The deployment package is built from this workspace and transferred directly to both EC2 instances, so a GitHub remote is not required.

## Before creating instances

Choose an AWS region and instance sizes in the EC2 console. Frontend builds need enough memory for Vite and TypeScript; `t3.small` or an equivalent 2 GiB instance is a practical starting point for each role. Check current region pricing and your account's Free Tier eligibility before launching. EC2 hours, EBS storage, public IPv4 addresses, and data transfer may be billed. [EC2 On-Demand pricing](https://aws.amazon.com/ec2/pricing/on-demand/) and [VPC public IPv4 pricing](https://aws.amazon.com/vpc/pricing/) are region/account dependent. Amazon Linux 2023 provides namespaced Node.js packages, including Node.js 24 in its current package guide; the install scripts use `nodejs24`. [AWS AL2023 Node.js guide](https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html).

Create both instances in the same VPC and region, using Amazon Linux 2023 x86_64 and public subnets. Keep these inbound rules:

| Security group | Inbound rule | Source |
|---|---|---|
| `app_client_sg` | HTTP TCP 80 | `0.0.0.0/0` |
| `app_client_sg` | SSH TCP 22 | Your current public IPv4 `/32` |
| `app_server_sg` | Custom TCP 8000 | `app_client_sg` as the source security group |
| `app_server_sg` | SSH TCP 22 | Your current public IPv4 `/32` |

Do not expose port 8000 to the internet or allow SSH from `0.0.0.0/0`. AWS warns that unrestricted SSH allows any internet address to try connecting and recommends restricting SSH to a known IP range. [AWS security group guidance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/creating-security-group.html). Leave outbound access enabled so instances can install packages and the backend can reach the Jolpica-F1 data provider. The backend public IPv4 is used for SSH and outbound internet only; browser API calls go through the frontend's Nginx proxy to the backend's private IPv4.

Create and download key pairs `app_server_key` and `app_client_key`; keep the `.pem` files private and out of this project. Launch instances named `app_server` and `app_client` with the matching groups and keys. Record the backend private/public addresses and frontend public address.

## Package and transfer this project

From PowerShell at the repository root:

```powershell
.\deploy\ec2\package-source.ps1
scp -i "$env:USERPROFILE\Downloads\app_server_key.pem" .\deploy\ec2\package\f1-companion-source.tar.gz ec2-user@<BACKEND_PUBLIC_DNS>:/home/ec2-user/
scp -i "$env:USERPROFILE\Downloads\app_client_key.pem" .\deploy\ec2\package\f1-companion-source.tar.gz ec2-user@<FRONTEND_PUBLIC_DNS>:/home/ec2-user/
```

Connect to each instance using its EC2 SSH Client command. Then extract the archive on each instance:

```bash
sudo mkdir -p /opt/f1-companion
sudo tar -xzf /home/ec2-user/f1-companion-source.tar.gz -C /opt/f1-companion --strip-components=1
```

The archive excludes local `.env` files, node_modules, build output, the SQLite development database, `.git`, and local caches. It contains migrations, lockfiles, source, and deployment scripts.

## Configure and start the backend

On `app_server`, create the protected environment file and edit it:

```bash
sudo install -d -o root -g root -m 0700 /etc/f1-companion
sudo install -o root -g root -m 0600 /opt/f1-companion/deploy/ec2/backend.env.example /etc/f1-companion/backend.env
sudo nano /etc/f1-companion/backend.env
```

Set `JWT_SECRET` to a fresh `openssl rand -base64 48` value, `CORS_ORIGIN` to `http://<FRONTEND_PUBLIC_IP>`, and `F1_SEASON=2026`. Keep `ADMIN_ACCESS_KEY` empty so private maintenance controls remain disabled while this HTTP-only setup has no TLS. Do not copy a real secret into chat, this repository, or the frontend environment. Then install and start:

```bash
sudo bash /opt/f1-companion/deploy/ec2/install-backend.sh
curl http://localhost:8000/health
```

The script installs Node.js 24 and pnpm, creates a dedicated service user, runs Prisma migrations, builds the API, imports the schedule and attempts a result import, then enables systemd service and timer units. SQLite is kept at `/var/lib/f1-companion/production.db`, outside the source tree. The timer retries the provider import every six hours. Importer errors are visible in `/api/v1/status` and leave data marked stale; they do not silently turn incomplete data into current data.

## Build and start the frontend

On `app_client`, use the backend's **private** IPv4 address:

```bash
sudo bash /opt/f1-companion/deploy/ec2/install-frontend.sh <BACKEND_PRIVATE_IP>
sudo systemctl status nginx
```

The project uses Nginx (not Apache `httpd`) to serve the built React app and proxy `/api/v1/` to the backend. The user-facing URL is `http://<FRONTEND_PUBLIC_IP>/`. The browser never connects directly to port 8000.

## Data and driver profiles

Once online, the scheduled backend timer requests the configured Jolpica-F1 provider every six hours. It retries as new classifications become available and surfaces import gaps as stale. It does not provide live race coverage. The importer currently supports verified 2026 scoring only; update `F1_SEASON` and add a verified ruleset before using a future season. [Jolpica's API reference](https://api.jolpi.ca/docs/) lists the available season, schedule, result, qualifying, and other data endpoints; the project validates imported data before updating standings.

Driver season profiles now show points, wins, podiums, and position from confirmed local standings; poles say unavailable when qualifying records are missing. The configured provider does not supply verified career achievements, so those remain explicitly unavailable rather than being guessed. Current data may still be stale if the provider has not returned missing rounds.

## Limitations

- This setup serves HTTP only and uses public IPs. Set up a domain and HTTPS before enabling admin maintenance or transmitting an admin access key.
- Use your current public IP `/32` for SSH. Update that rule if your ISP changes your address.
- Ephemeral frontend public IPs can change when instances stop/start; update the backend `CORS_ORIGIN` if needed. The frontend continues proxying to the backend's private IP.
- Configure an AWS budget alert and stop or terminate instances when finished. Check EBS volumes and public IPv4 addresses separately when cleaning up.
- No visitor account or profile data is collected. The backend database stores only public championship records and maintenance audit data.
