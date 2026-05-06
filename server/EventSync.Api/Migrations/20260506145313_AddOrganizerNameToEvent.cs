using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace EventSync.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddOrganizerNameToEvent : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "OrganizerName",
                table: "Events",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "OrganizerName",
                table: "Events");
        }
    }
}
