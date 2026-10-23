FROM postgres:17-trixie

# Install extension binaries only. The checked-in migration owns CREATE EXTENSION,
# so a new database remains empty until the migration baseline has been applied.
COPY install-postgis.sh /usr/local/bin/install-postgis.sh
RUN sh /usr/local/bin/install-postgis.sh
